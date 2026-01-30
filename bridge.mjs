#!/usr/bin/env node
/**
 * 飞书 × MoltBot 桥接器
 *
 * 通过 WebSocket 长连接模式对接飞书，无需公网服务器
 *
 * 架构: 飞书用户 ←→ 飞书云端 ←→ 桥接脚本(本地) ←→ MoltBot Gateway
 */

import WebSocket from 'ws';
import { config } from 'dotenv';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

config();

// ============ 配置 ============
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || readSecretFromFile();
const MOLTBOT_GATEWAY_URL = process.env.MOLTBOT_GATEWAY_URL || 'ws://localhost:18789';
const MOLTBOT_AGENT_ID = process.env.MOLTBOT_AGENT_ID || 'main';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// 飞书 API 地址
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// ============ 工具函数 ============

function readSecretFromFile() {
  const secretPath = process.env.FEISHU_APP_SECRET_PATH ||
    join(homedir(), '.moltbot', 'secrets', 'feishu_app_secret');
  try {
    return readFileSync(secretPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function log(level, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}]`, ...args);
}

// ============ 飞书 API ============

let tenantAccessToken = null;
let tokenExpireTime = 0;

async function getTenantAccessToken() {
  if (tenantAccessToken && Date.now() < tokenExpireTime) {
    return tenantAccessToken;
  }

  const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    })
  });

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`获取 token 失败: ${data.msg}`);
  }

  tenantAccessToken = data.tenant_access_token;
  tokenExpireTime = Date.now() + (data.expire - 300) * 1000;
  log('INFO', '获取 tenant_access_token 成功');
  return tenantAccessToken;
}

async function getWebSocketUrl() {
  const token = await getTenantAccessToken();

  const response = await fetch(`${FEISHU_API_BASE}/callback/ws/endpoint`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`获取 WebSocket URL 失败: ${data.msg}`);
  }

  return data.data.URL;
}

async function replyMessage(messageId, content) {
  const token = await getTenantAccessToken();

  const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages/${messageId}/reply`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: JSON.stringify({ text: content }),
      msg_type: 'text'
    })
  });

  const data = await response.json();
  if (data.code !== 0) {
    log('ERROR', `回复消息失败: ${data.msg}`);
    return false;
  }
  return true;
}

async function addReaction(messageId, emoji = 'PROCESSING') {
  const token = await getTenantAccessToken();

  try {
    await fetch(`${FEISHU_API_BASE}/im/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reaction_type: { emoji_type: emoji }
      })
    });
  } catch (e) {
    // 忽略 reaction 错误
  }
}

// ============ MoltBot Gateway 连接 ============

let moltbotWs = null;
let pendingRequests = new Map();

async function connectToMoltbot() {
  return new Promise((resolve, reject) => {
    moltbotWs = new WebSocket(MOLTBOT_GATEWAY_URL);

    moltbotWs.on('open', () => {
      log('INFO', '已连接到 MoltBot Gateway');
      resolve();
    });

    moltbotWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMoltbotMessage(message);
      } catch (e) {
        log('ERROR', '解析 MoltBot 消息失败:', e);
      }
    });

    moltbotWs.on('close', () => {
      log('WARN', 'MoltBot Gateway 连接关闭，5秒后重连...');
      setTimeout(connectToMoltbot, 5000);
    });

    moltbotWs.on('error', (err) => {
      log('ERROR', 'MoltBot Gateway 错误:', err.message);
      reject(err);
    });
  });
}

function handleMoltbotMessage(message) {
  const { requestId, type, content, error } = message;

  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  if (type === 'response' || type === 'complete') {
    pending.resolve(content);
    pendingRequests.delete(requestId);
  } else if (type === 'error') {
    pending.reject(new Error(error));
    pendingRequests.delete(requestId);
  }
}

async function sendToMoltbot(userMessage, userId) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('MoltBot 响应超时'));
    }, 120000); // 2分钟超时

    pendingRequests.set(requestId, {
      resolve: (content) => {
        clearTimeout(timeout);
        resolve(content);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });

    const payload = {
      type: 'message',
      requestId,
      agentId: MOLTBOT_AGENT_ID,
      userId: `feishu_${userId}`,
      content: userMessage
    };

    moltbotWs.send(JSON.stringify(payload));
  });
}

// ============ 直接调用 Anthropic API (备用) ============

async function callAnthropicDirect(userMessage) {
  if (!ANTHROPIC_API_KEY) {
    return '错误: 未配置 ANTHROPIC_API_KEY，且无法连接到 MoltBot Gateway';
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: userMessage }]
  });

  return message.content[0].text;
}

// ============ 消息处理 ============

const processedMessages = new Set();

async function handleFeishuMessage(event) {
  const message = event.message;
  if (!message) return;

  const messageId = message.message_id;

  // 去重
  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);

  // 5分钟后清理
  setTimeout(() => processedMessages.delete(messageId), 5 * 60 * 1000);

  // 只处理文本消息
  if (message.message_type !== 'text') {
    await replyMessage(messageId, '目前只支持文本消息');
    return;
  }

  // 解析消息内容
  let content;
  try {
    content = JSON.parse(message.content);
  } catch {
    return;
  }

  let userText = content.text || '';

  // 移除 @机器人
  const mentions = message.mentions || [];
  for (const mention of mentions) {
    userText = userText.replace(mention.key, '').trim();
  }

  if (!userText) return;

  const userId = event.sender?.sender_id?.user_id || 'unknown';
  log('INFO', `收到消息 [${userId}]: ${userText}`);

  // 添加 "思考中" 表情
  await addReaction(messageId, 'PROCESSING');

  try {
    let reply;

    // 优先使用 MoltBot Gateway
    if (moltbotWs && moltbotWs.readyState === WebSocket.OPEN) {
      reply = await sendToMoltbot(userText, userId);
    } else {
      // 备用: 直接调用 Anthropic API
      reply = await callAnthropicDirect(userText);
    }

    log('INFO', `回复消息: ${reply.substring(0, 100)}...`);
    await replyMessage(messageId, reply);
  } catch (error) {
    log('ERROR', '处理消息失败:', error);
    await replyMessage(messageId, `处理消息时出错: ${error.message}`);
  }
}

// ============ 飞书 WebSocket 连接 ============

let feishuWs = null;
let reconnectAttempts = 0;

async function connectToFeishu() {
  try {
    const wsUrl = await getWebSocketUrl();
    log('INFO', '获取飞书 WebSocket URL 成功');

    feishuWs = new WebSocket(wsUrl);

    feishuWs.on('open', () => {
      log('INFO', '已连接到飞书 WebSocket');
      reconnectAttempts = 0;
    });

    feishuWs.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // 处理心跳
        if (message.type === 'pong') return;

        // 处理事件
        if (message.header?.event_type === 'im.message.receive_v1') {
          await handleFeishuMessage(message.event);
        }

        // 确认消息
        if (message.header?.event_id) {
          feishuWs.send(JSON.stringify({
            type: 'ack',
            event_id: message.header.event_id
          }));
        }
      } catch (e) {
        log('ERROR', '处理飞书消息失败:', e);
      }
    });

    feishuWs.on('close', () => {
      log('WARN', '飞书 WebSocket 关闭');
      scheduleReconnect();
    });

    feishuWs.on('error', (err) => {
      log('ERROR', '飞书 WebSocket 错误:', err.message);
    });

    // 心跳
    setInterval(() => {
      if (feishuWs && feishuWs.readyState === WebSocket.OPEN) {
        feishuWs.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

  } catch (error) {
    log('ERROR', '连接飞书失败:', error);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
  log('INFO', `${delay / 1000}秒后重连飞书...`);
  setTimeout(connectToFeishu, delay);
}

// ============ 主程序 ============

async function main() {
  console.log(`
╔════════════════════════════════════════════╗
║     飞书 × MoltBot 桥接器                   ║
║     Feishu × MoltBot Bridge                ║
╚════════════════════════════════════════════╝
`);

  // 验证配置
  if (!FEISHU_APP_ID) {
    console.error('错误: 请设置 FEISHU_APP_ID 环境变量');
    process.exit(1);
  }

  if (!FEISHU_APP_SECRET) {
    console.error('错误: 请设置 FEISHU_APP_SECRET 环境变量');
    process.exit(1);
  }

  log('INFO', `飞书 App ID: ${FEISHU_APP_ID}`);
  log('INFO', `MoltBot Gateway: ${MOLTBOT_GATEWAY_URL}`);

  // 尝试连接 MoltBot Gateway
  try {
    await connectToMoltbot();
  } catch (e) {
    log('WARN', 'MoltBot Gateway 连接失败，将使用 Anthropic API 直连模式');
    if (!ANTHROPIC_API_KEY) {
      log('WARN', '未配置 ANTHROPIC_API_KEY，请确保 MoltBot Gateway 可用');
    }
  }

  // 连接飞书
  await connectToFeishu();

  log('INFO', '桥接器已启动，等待消息...');
}

main().catch(console.error);
