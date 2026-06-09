# ⚖️ 称重色粉计算器

一款专为工业生产场景设计的称重与色粉配比计算工具，支持 iOS / Android / Web 多端运行。

## 📋 功能特性

### 核心功能
- **多批次称重录入** — 支持 10+ 批次称重数据录入，已输入行高亮显示，直观区分已填/未填
- **实时总重量计算** — 自动汇总所有已输入的重量数据
- **色粉配比计算** — 输入色粉添加比例，自动生成精确的色粉添加量
- **单位自由切换** — 重量单位（kg/g）、比例单位（‰/%）、结果单位（g/mg/kg）均可自定义

### 实用功能
- **历史记录** — 保存计算记录，支持查看和快速回填
- **按键音效** — 输入数字时播放按键音效，提供操作反馈
- **语音读数** — 支持中文语音朗读输入数值，可选多种中文语音
- **屏幕常亮** — 使用 Capacitor KeepAwake 插件，录入数据时防止屏幕自动熄灭
- **灵动岛适配** — 完美适配 iPhone 刘海屏和灵动岛

## 🛠️ 技术栈

| 技术 | 说明 |
|------|------|
| React 18 | UI 框架 |
| TypeScript | 类型安全 |
| Vite 6 | 构建工具 |
| Capacitor 8 | 跨平台打包 |
| Keep Awake 插件 | 屏幕常亮（原生实现） |

## 📱 快速开始

### 本地开发

```bash
# 克隆项目
git clone https://github.com/iwhu-beep/weight-calculator.git
cd weight-calculator

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000 即可使用。

### 构建 Web 版本

```bash
npm run build
npm run preview
```

### 构建 iOS IPA（通过 GitHub Actions）

本项目已配置 GitHub Actions，推送到 `master` 分支会自动在 macOS 环境构建 IPA。

**下载方式：**
1. 打开 [Actions 页面](https://github.com/iwhu-beep/weight-calculator/actions)
2. 点击最新的成功构建
3. 在 Artifacts 区域下载 `App.ipa`

### 本地构建 iOS（需要 Mac + Xcode）

```bash
# 构建前端
npm run build

# 添加 iOS 平台（首次）
npx cap add ios

# 同步资源
npx cap sync ios

# 打开 Xcode
npx cap open ios
```

在 Xcode 中选择设备后点击 Build 即可。

## ⚙️ 设置说明

### 声音与语音
- **按键声音** — 输入时播放提示音
- **语音读数** — 开启后朗读输入数值
- **语音选择** — 支持多种中文语音（普通话/繁體/粵語）
- **语速调节** — 0.5x ~ 2.0x 可调

### 输入设置
- **初始显示行数** — 默认显示的称重输入行数
- **最大输入行数** — 可添加的最大行数限制

### 单位设置
- **称重单位** — kg / g
- **比例单位** — ‰（千分比）/ %（百分比）
- **结果单位** — g / mg / kg

### 屏幕设置
- **屏幕常亮** — 防止录入时屏幕自动熄灭

## 📐 计算公式

```
色粉添加量 = 总重量 × 色粉比例
```

**示例：** 总重量 100kg，色粉比例 5‰ → 色粉添加量 = 500g

系统会自动处理单位换算：
- 重量 g → kg 自动 ÷1000
- 比例 % → ‰ 自动 ×10
- 结果 g → mg 自动 ×1000，g → kg 自动 ÷1000

## 📂 项目结构

```
weight-calculator/
├── src/
│   ├── App.tsx          # 主应用组件
│   ├── index.css        # 全局样式
│   ├── main.tsx         # 入口文件
│   └── vite-env.d.ts    # Vite 类型声明
├── .github/
│   └── workflows/
│       └── build-ipa.yml  # iOS IPA 自动构建
├── capacitor.config.json  # Capacitor 配置
├── vite.config.ts         # Vite 配置
├── tsconfig.json          # TypeScript 配置
└── package.json
```

## ⚠️ 注意事项

1. **屏幕常亮** 功能依赖 Capacitor 原生插件，仅在打包后的 App 中生效，浏览器预览时无效
2. **IPA 安装** 需要 Apple 开发者账号签名后才能安装到真机
3. 数据存储于设备本地（localStorage），卸载 App 后记录会丢失

## 📄 License

MIT
