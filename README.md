# EPD-BLE-SYNC

ESP32-S3 墨水屏（2.13" 三色 EPD 212×104）天气站的**手机端蓝牙同步工具**。

手机负责上网取天气，取到后通过 **BLE** 写入 ESP32——所以 ESP32 自己不需要连 WiFi，
也就不受「只支持 2.4GHz、家里路由器是 5GHz」的限制。

> 在线地址（部署后）：`https://abe9-mix.github.io/EPD-BLE-SYNC/`

---

## 为什么是蓝牙写入，而不是"手机共享蓝牙网络"

**手机蓝牙网络共享（Bluetooth PAN）在 ESP32-S3 上不可行**，这是硬件限制：

- ESP32-S3 **只有 Bluetooth LE（BLE 5.0），没有蓝牙经典（BR/EDR）**
- 蓝牙网络共享走的是经典蓝牙的 BNEP 协议，S3 的射频与协议栈里没有这一层
- 连带地，Arduino 的 `BluetoothSerial`（经典蓝牙串口）在 S3 上编译都过不去

**唯一可行路线**：ESP32 做 BLE 外设（GATT Server），手机取到天气后写入特征值。

---

## 快速开始

### 前提

| 项目 | 要求 |
|---|---|
| 浏览器 | **Chrome / Edge**（桌面或 Android）。**iOS 全系不支持 Web Bluetooth**，Safari/Firefox 也不支持 |
| 安全上下文 | 必须是 **https** 或 **localhost**。直接双击用 `file://` 打开不行，`navigator.bluetooth` 会是 `undefined` |
| 固件 | ESP32 已烧录带 BLE 的天气站固件，设备名 `EPD-Weather` |

本页部署在 GitHub Pages（https），满足安全上下文要求，手机直接访问即可。

### 使用

1. 手机 Chrome 打开本页
2. 点「连接设备」→ 选 `EPD-Weather`
3. 输入城市名（支持中文，如「杭州」）
4. 点「取天气并同步」，墨水屏应立刻刷新

---

## BLE 协议

采用 **Nordic UART Service (NUS)**，通用 BLE 调试 App（nRF Connect / LightBlue）也能直接连。

| 用途 | UUID |
|---|---|
| Service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX（手机 → ESP32） | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| TX（ESP32 → 手机） | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |

写入 UTF-8 JSON，**以 `\n` 结尾**，字段全部可选（缺省保留屏上原值）：

```json
{"temp":23,"feels":25,"desc":"Sunny","hum":52,"uv":3,"tlow":18,"thigh":27,"fc_date":"11-03","fc_desc":"Cloudy","fc_low":16,"fc_high":24}
```

查询状态：`{"cmd":"status"}`

> ⚠️ **描述只能用英文**：墨水屏字库是内置 5×7 ASCII 字模，中文会渲染成方框。
> 请用 `Sunny / Cloudy / Rain / Snow / Fog / Storm` 这类短词（≤16 字符）。

---

## 数据源

[Open-Meteo](https://open-meteo.com/) —— 免费、无需 API Key、支持浏览器直连（CORS `*`）。

- 城市 → 经纬度：`https://geocoding-api.open-meteo.com/v1/search`
- 天气：`https://api.open-meteo.com/v1/forecast`

---

## 本地开发

```powershell
# 在仓库根目录
python -m http.server 8000
# 浏览器打开 http://localhost:8000/web/index.html
```

> `file://` 直接打开会因为不是安全上下文而无法使用蓝牙。

---

## 目录结构

```
EPD-BLE-SYNC/
├─ index.html          # 主页面（GitHub Pages 入口）
├─ web/index.html      # 同一文件的原始位置
└─ 蓝牙同步方案.md      # 方案对比：七种同步方式、为什么 PAN 不可行、踩坑清单
```

---

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 页面提示不支持蓝牙 | 换了 Safari/Firefox 或 iOS 设备；改用 Chrome/Edge |
| 点连接没反应 / 搜不到设备 | ESP32 未上电或已被其他手机占用；重启 ESP32 |
| 写入成功但屏幕没变 | 固件版本不对（需 v3 BLE 版），或 JSON 少了结尾换行 |
| 中文显示成方框 | 正常现象，字库仅 ASCII，请改用英文描述 |
| 城市查不到 | Open-Meteo 返回 200 但无 `results` 字段，换一个城市名 |

更多细节见 [蓝牙同步方案.md](蓝牙同步方案.md)。
