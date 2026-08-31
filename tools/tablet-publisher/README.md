# League Akari 平板推送工具（独立版）

不开 League Akari 桌面端，也能让平板页面实时跟随选人。

这个小工具在后台监听英雄联盟客户端（LCU）的选人状态，按与桌面端「平板伴侣」完全相同的
协议推送到房间服务器（`PUT /api/rooms/<房间码>/state`，Bearer 令牌鉴权，20 秒心跳 +
状态变化即时推送）。快照构建逻辑与桌面端 `src/main/shards/tablet-companion/snapshot.ts`
保持一致。

- 零第三方依赖，只需要 **Node.js >= 18.17**（推荐 20+，使用内置 `fetch`）
- 英雄联盟客户端未启动时也会按心跳推送「客户端离线」，平板显示「等待游戏电脑」
- 退出时（Ctrl+C）会主动推送一次离线状态

## 配置

```bash
cp tablet-publisher.config.example.json tablet-publisher.config.json
```

编辑 `tablet-publisher.config.json`：

| 字段               | 说明                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `serverUrl`        | 房间服务器地址，如 `https://akari.nightyu.com`                      |
| `roomCode`         | 房间码，与 Akari「设置 → 平板伴侣」中填写的相同                     |
| `publishToken`     | 推送令牌，与 Akari「设置 → 平板伴侣」中填写的相同（至少 16 个字符） |
| `pollIntervalMs`   | 客户端状态轮询间隔，默认 2500                                       |
| `heartbeatMs`      | 心跳推送间隔，默认 20000（服务端 45 秒无心跳判定离线）              |
| `publishTimeoutMs` | 推送超时，默认 8000                                                 |
| `leagueClientDir`  | 可选，英雄联盟客户端所在目录（含 `lockfile`）。留空则自动探测       |

`tablet-publisher.config.json` 含有推送令牌，**不要提交到 Git**（目录内 `.gitignore` 已排除）。

## 运行

```bash
node publisher.mjs            # 持续运行（前台，带中文日志）
node publisher.mjs --once     # 推送一次后退出，用于验证配置是否正确
```

## 开机自启（三选一）

**方案 A：启动文件夹 + 静默脚本（推荐，最省事）**

`Win+R` 输入 `shell:startup` 打开启动文件夹，把 `run-hidden.vbs` 的快捷方式放进去。
开机后无窗口后台运行。

**方案 B：pm2（机器上已有 pm2 时）**

```bash
pm2 start publisher.mjs --name akari-tablet-publisher
pm2 save
```

**方案 C：任务计划程序**

新建基本任务 → 触发器「登录时」→ 操作「启动程序」→
程序 `node.exe`，参数 `C:\...\tools\tablet-publisher\publisher.mjs`，起始于该目录。

## 与 Akari 桌面端的关系

两者使用同一房间、同一协议，同时运行不会冲突（快照内容相同，后到覆盖先到）。
但为避免重复心跳，建议二选一：

- 常用本工具：在 Akari「设置 → 平板伴侣」中关闭推送开关；
- 临时开 Akari：直接打开即可，它的推送会接管最新状态。

## 排错

- `推送失败：HTTP 401` —— 推送令牌错误，与 Akari 设置或服务端 `.env` 核对。
- `推送失败：HTTP 404` —— 房间码错误。
- 日志一直「客户端离线」但客户端已打开 —— 用 `leagueClientDir` 显式指定客户端目录。
