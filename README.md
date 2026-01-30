# 飞书 × MoltBot 桥接器

将 MoltBot (原 Clawdbot) 接入飞书机器人，**无需公网服务器、无需域名、无需 ngrok**。

## 原理

```
飞书用户 ←→ 飞书云端 ←→ 桥接脚本(本地) ←→ MoltBot Gateway
```

飞书 SDK 支持 WebSocket 长连接模式，桥接脚本在本地运行，主动连接飞书云端接收消息。

## 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 添加「机器人」能力
4. 记录 **App ID** 和 **App Secret**

### 2. 配置飞书权限

在「权限管理」添加以下权限：

- `im:message` - 获取与发送单聊、群组消息
- `im:message.group_at_msg` - 接收群聊中 @机器人消息
- `im:message.p2p_msg` - 接收用户发给机器人的单聊消息
- `contact:user.base` - 获取用户基本信息

### 3. 配置事件订阅

1. 进入「事件订阅」
2. **选择「长连接」模式**（关键！）
3. 添加事件：`im.message.receive_v1`（接收消息）

### 4. 发布应用

点击「创建版本」发布应用（每次修改配置后都需要发布新版本）

### 5. 安装依赖

```bash
npm install
```

### 6. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```
FEISHU_APP_ID=cli_xxxxxx
FEISHU_APP_SECRET=xxxxxx
```

### 7. 启动桥接器

```bash
npm start
```

或直接运行：

```bash
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node bridge.mjs
```

## 配合 MoltBot 使用

如果你已安装 MoltBot，确保 Gateway 正在运行：

```bash
moltbot gateway
```

桥接器会自动连接到 `ws://localhost:18789`。

## 独立模式（不使用 MoltBot）

如果只想用 Claude API，配置 `ANTHROPIC_API_KEY`：

```
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

桥接器会在 MoltBot Gateway 不可用时自动切换到直连模式。

## 设置开机自启（macOS）

```bash
npm run setup-service
launchctl load ~/Library/LaunchAgents/com.moltbot.feishu-bridge.plist
```

查看日志：

```bash
tail -f ~/.moltbot/logs/feishu-bridge.out.log
```

## 配置项

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `MOLTBOT_GATEWAY_URL` | MoltBot Gateway 地址 | `ws://localhost:18789` |
| `MOLTBOT_AGENT_ID` | MoltBot Agent ID | `main` |
| `ANTHROPIC_API_KEY` | Anthropic API 密钥（备用） | - |

## 常见问题

### 添加事件按钮是灰色的？

需要先选择「长连接」模式，按钮才会变为可用。

### 发消息没有回复？

1. 检查是否添加了「接收消息」事件
2. 检查是否发布了新版本
3. 查看桥接器日志是否有错误

### 如何查看日志？

```bash
# 直接运行时看终端输出
# 作为服务运行时:
tail -f ~/.moltbot/logs/feishu-bridge.out.log
```

## 参考资料

- [MoltBot 官方文档](https://docs.molt.bot)
- [飞书开放平台](https://open.feishu.cn)
- [飞书 WebSocket 长连接](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN)

## License

MIT
