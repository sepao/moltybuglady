#!/usr/bin/env node
/**
 * 生成 macOS launchd 服务配置
 * 实现开机自启动和自动重启
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const HOME = homedir();
const LAUNCH_AGENTS_DIR = join(HOME, 'Library', 'LaunchAgents');
const PLIST_NAME = 'com.moltbot.feishu-bridge.plist';
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, PLIST_NAME);

// 日志目录
const LOG_DIR = join(HOME, '.moltbot', 'logs');
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

const projectDir = resolve(process.cwd());
const nodePath = execSync('which node').toString().trim();

const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.moltbot.feishu-bridge</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${join(projectDir, 'bridge.mjs')}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${projectDir}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${join(LOG_DIR, 'feishu-bridge.out.log')}</string>

    <key>StandardErrorPath</key>
    <string>${join(LOG_DIR, 'feishu-bridge.err.log')}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
`;

// 确保目录存在
if (!existsSync(LAUNCH_AGENTS_DIR)) {
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
}

// 写入 plist 文件
writeFileSync(PLIST_PATH, plistContent);
console.log(`已生成服务配置: ${PLIST_PATH}`);

console.log(`
========================================
服务配置完成！

启动服务:
  launchctl load ${PLIST_PATH}

停止服务:
  launchctl unload ${PLIST_PATH}

查看日志:
  tail -f ${join(LOG_DIR, 'feishu-bridge.out.log')}
  tail -f ${join(LOG_DIR, 'feishu-bridge.err.log')}

注意: 启动前请确保 .env 文件已正确配置
========================================
`);
