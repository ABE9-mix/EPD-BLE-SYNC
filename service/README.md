# EPD 天气同步 · Windows 后台服务

让电脑开机自动把天气推给墨水屏，不用再开手机网页。

- 常驻内存 **约 44 MB**（其中约 40 MB 是 Windows BLE/WinRT 协议栈，Python 本体仅 ~5 MB），空闲 CPU ≈ 0
- 默认定时 **60 分钟**同步一次；天气没变化时**跳过写屏**（保护墨水屏寿命）
- 断网/找不到设备会自动退避重试（30s → 1m → 2m → 5m → 10m）

---

## 一、先说清楚：为什么不是传统的"Windows 服务"

你要的是"随电脑打开自动跑"，标准答案是注册成 Windows 服务（SYSTEM 账户）。
**但这套方案在蓝牙上跑不通**，原因是硬件/系统层面的：

| 问题 | 说明 |
|---|---|
| BLE 走 WinRT | Windows 上操作 BLE 用的是 `Windows.Devices.Bluetooth`，它属于**用户会话**的蓝牙运行时 |
| 服务在 Session 0 | Windows 服务没有用户桌面会话，枚举不到蓝牙设备，扫描直接失败 |
| 绕过的代价大 | 要在 SYSTEM 里访问用户会话的 BLE，得写 WinRT 打包组件或 IPC 中转，脆弱且极易被系统更新打断 |

所以业界通行做法是：**用「用户登录时自动启动的隐藏任务」**。
效果和你要的一致——开机后自己跑、没有窗口、不用管——只是它挂在你的用户账户下而不是 SYSTEM。

> 这也意味着：**必须先登录 Windows 它才会启动**。如果你需要"开机未登录也运行"，
> 那只能改走 WiFi 方案（ESP32 自己连路由器），或者写 C#/WinRT 的中转服务，复杂度高很多。

另外，当前账户**不是管理员**，注册 SYSTEM 服务本来也需要提权，这条也走不通。

---

## 二、安装

```powershell
cd F:\AIchat\epd_ble\service
.\install_task.ps1 -City 杭州
```

脚本会依次：
1. 检查 Python 虚拟环境、蓝牙适配器
2. 写入 `config.json`
3. **先试跑一次**（失败会提示原因，并问你是否继续）
4. 注册计划任务 `EPD-Weather-Sync`（登录时启动，隐藏窗口）

装完就完事了，重启电脑会自动运行。

### 常用命令

```powershell
.\install_task.ps1 -Status      # 看状态、内存占用、最近日志
.\install_task.ps1 -Uninstall   # 卸载
.\install_task.ps1 -City 上海 -Interval 30   # 改城市/改间隔并重装
```

---

## 三、配置

`config.json`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `city` | `Hangzhou` | 城市名，支持中文（`杭州`）或拼音 |
| `language` | `zh` | 地理编码语言 |
| `interval_minutes` | `60` | 同步间隔（分钟） |
| `device_address` | `""` | 首次连上后自动填入；填了就不必每次扫描，更快 |
| `scan_timeout_s` | `12` | 扫描超时 |
| `only_when_changed` | `true` | 天气无变化时不写屏 |
| `retry_backoff_s` | `[30,60,120,300,600]` | 失败退避序列 |

改完不用重装，重启任务即可：

```powershell
Stop-ScheduledTask  -TaskName EPD-Weather-Sync
Start-ScheduledTask -TaskName EPD-Weather-Sync
```

---

## 四、排查

日志：`F:\AIchat\epd_ble\service\logs\epd-sync.log`

| 日志表现 | 原因 | 处理 |
|---|---|---|
| `没找到 EPD-Weather（期间匿名广播 N 个）` | 墨水屏没上电 / 被手机连着 / 固件刚断连没重新广播 | 确认上电、手机断开蓝牙连接 |
| `BLE 错误：...` | 适配器占用或驱动问题 | 关掉其它连 BLE 的程序再试 |
| `取天气失败：找不到城市` | 城市名不认识 | 换成更常见的名称，如 `Beijing` |
| 一直成功但屏幕不刷新 | 固件是旧版（`ENABLE_WEATHER_SYNC=0` 的老 bug） | 重新烧录 v3.1+ 固件 |
| `天气无变化，跳过写屏` | 正常行为，不是错误 | 无需处理 |

手动跑一次看详细输出：

```powershell
.\.venv\Scripts\python.exe epd_sync.py --once
```

---

## 五、资源占用实测

| 项目 | 数值 | 说明 |
|---|---|---|
| 稳定态内存 | **≈ 44 MB** | PID 1: 4.7 MB（Python 本体）+ PID 2: 39 MB（Windows BLE 协议栈） |
| 空闲 CPU | ≈ 0.00s | 只在同步与扫描时短暂占用 |
| 网络 | 每小时 2 个请求 | 约几十 KB |
| 磁盘 | 日志 1MB×3 轮转 | 不会无限增长 |

> 那 ~40 MB 是 **Windows 自己加载的蓝牙/WinRT 运行时**，任何用 bleak 的程序都一样，
> 换 C#/Rust 写也省不掉。想进一步压内存只能改走 WiFi 方案（ESP32 自己联网），
> 代价是硬件要常连 WiFi、功耗高很多，和墨水屏的定位相悖。

## 六、实现要点

- **bleak**（Windows 走 WinRT，无需装驱动/Zadig）
- BLE 跑在独立线程的 asyncio 事件循环里，主线程只做调度
- 按设备名 + NUS 服务 UUID + 名字前缀三级匹配找设备
- 整包写入失败时退化为 180 字节分片
- 成功连上后把 MAC 地址记进 `config.json`，之后免扫描直连
- `pythonw.exe` 启动，无控制台窗口

文件：

```
service/
├─ epd_sync.py        # 同步主程序
├─ install_task.ps1   # 安装/卸载/状态
├─ config.json        # 配置（自动生成）
├─ state.json         # 上次天气缓存（自动生成）
├─ logs/              # 轮转日志（1MB × 3）
└─ .venv/             # 独立虚拟环境
```
