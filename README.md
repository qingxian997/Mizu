# Mizu 🎮

<div align="center">

**现代化游戏库管理器**

一个基于 Electron 构建的精美游戏库管理应用，支持 Steam 集成、AI 分析、好友动态等功能。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-40.4.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)

</div>

---

## 📖 目录

- [功能特性](#-功能特性)
- [界面预览](#-界面预览)
- [快速开始](#-快速开始)
- [配置说明](#-配置说明)
- [功能详解](#-功能详解)
- [技术架构](#-技术架构)
- [开发指南](#-开发指南)
- [常见问题](#-常见问题)

---

## ✨ 功能特性

### 🎮 游戏库管理

- **多平台支持**：自动扫描 Steam、Epic Games等平台已安装的游戏
- **手动添加**：支持手动选择可执行文件或快捷方式添加游戏
- **封面自动获取**：自动从 Steam 获取游戏封面
- **拖拽排序**：支持拖拽调整游戏顺序
- **批量操作**：支持批量删除游戏

### 🤖 AI 功能

- **AI 分析**：基于游戏库提供智能游戏分析
- **战术建议**：获取游戏攻略和技巧
- **游戏推荐**：根据已有游戏推荐新游戏
- **自定义提问**：向 AI 提问关于游戏的任何问题

### 👥 社区功能

- **Steam 好友**：查看好友在线状态、正在玩的游戏
- **好友动态**：
  - 好友正在玩的游戏
  - 好友首次启动的新游戏
  - 好友最近获得的成就
- **游戏新闻**：获取游戏库中游戏的最新资讯
- **用户动态**：发布、编辑、点赞动态

### 📊 数据统计

- **游玩时间**：记录并显示每个游戏的游玩时长
- **最近游玩**：按时间排序显示最近玩过的游戏
- **磁盘空间**：实时显示各磁盘空间使用情况

### 🎨 界面设计

- **毛玻璃效果**：现代化的毛玻璃 UI 设计
- **深色主题**：护眼的深色配色方案
- **响应式布局**：自适应不同屏幕尺寸
- **流畅动画**：平滑的过渡动画效果

---
---

## 🖼 界面预览

### 游戏库
展示所有游戏，支持网格视图和详情视图，可按全部/最近/收藏筛选。
![Uploading 游戏库.png…]()

### 游戏详情
显示游戏详细信息，包括游玩时间、最后游玩日期、启动按钮、Steam 同步、AI 分析等。
![Uploading 游戏详情页.png…]()

### 社区
好友列表、好友动态、游戏新闻、用户动态的综合展示。
![Uploading 主页.png…]()

### 设置
账户配置、Steam API 设置、AI 设置、外观自定义等。
![Uploading 游戏设置.png…]()

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- Windows 操作系统

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/qingxian997/Mizu.git
cd Mizu/electron
```

2. **安装依赖**

```bash
# npm install electron --save-dev
```

3. **启动应用**

```bash
npm run start
```

### 构建打包

```bash
# 使用 electron-builder 打包
npm run build
```

---

## ⚙️ 配置说明

### Steam API 配置

要使用 Steam 相关功能，需要配置 Steam Web API：

1. **获取 API Key**
   - 访问 [Steam Web API Key](https://steamcommunity.com/dev/apikey)
   - 登录 Steam 账户
   - 填写域名（可填任意），获取 API Key

2. **获取 Steam ID**
   - 登录 [Steam 个人资料页面](https://steamcommunity.com/my/profile)
   - 查看 URL，格式为 `https://steamcommunity.com/profiles/你的SteamID`
   - 或在设置中自动获取

3. **配置应用**
   - 打开 Mizu 设置 → 账户
   - 填入 Steam API Key 和 Steam ID
   - 点击保存

### AI 功能配置

支持 OpenAI 和 Google Gemini 两种 AI 服务：

#### OpenAI

```
API 地址: https://api.openai.com/v1
API Key: sk-xxxxx
模型: gpt-3.5-turbo / gpt-4
```

#### Google Gemini

```
API 地址: https://generativelanguage.googleapis.com/v1beta
API Key: xxxx
模型: gemini-pro
```

---

## 📚 功能详解

### 游戏导入

#### 自动扫描

点击「添加其他已安装的游戏」→「扫描已安装游戏」，自动扫描以下平台：

- **Steam**：通过注册表和 `steamapps` 目录
- **Epic Games**：通过注册表和 Manifest 文件
- **miHoYo**：扫描常见安装路径
- **WeGame**：扫描常见安装路径

#### 手动添加

1. 点击「添加游戏」按钮
2. 选择游戏可执行文件（.exe）或快捷方式（.lnk）
3. 填写游戏名称（中英文）
4. 可选：设置封面、Steam AppId
5. 保存

#### Steam 库导入

配置 Steam API 后，可一键导入 Steam 库中的所有游戏。

### 游戏启动

支持多种启动方式：

- **直接启动**：运行 .exe 可执行文件
- **快捷方式**：解析 .lnk 快捷方式并启动目标
- **Steam 协议**：使用 `steam://rungameid/xxx` 启动 Steam 游戏
- **URL 链接**：支持通过 URL 协议启动游戏

### Steam 同步

点击游戏详情页的「同步 Steam」按钮：

- 更新游玩时间
- 更新最后游玩日期
- 获取成就信息
- 更新游戏封面

### 好友动态

好友动态显示以下内容：

| 类型 | 说明 | 显示条件 |
|------|------|----------|
| 正在玩 | 好友当前正在玩的游戏 | 实时获取 |
| 首次启动 | 好友首次启动的新游戏 | 总游玩时间 < 60 分钟 |
| 获得成就 | 好友最近获得的游戏成就 | 两周内获得的成就 |

---

## 🏗 技术架构

### 项目结构

```
mizu/
├── electron/
│   ├── main.js          # 主进程入口
│   ├── preload.js       # 预加载脚本
│   ├── index.html       # 渲染进程（UI）
│   ├── package.json     # 项目配置
│   └── node_modules/    # 依赖包
└── README.md
```

### 技术栈

| 技术 | 用途 |
|------|------|
| Electron | 桌面应用框架 |
| HTML/CSS/JS | 前端界面 |
| Tailwind CSS | 样式框架 |
| Lucide Icons | 图标库 |
| Steam Web API | Steam 数据获取 |
| OpenAI/Gemini API | AI 功能 |

### 数据存储

游戏数据存储在用户数据目录：

```
Windows: %APPDATA%/mizu/games.json
```

### IPC 通信

主进程与渲染进程通过 IPC 通信：

```javascript
// 渲染进程调用
const games = await window.electronAPI.getGames();

// 主进程处理
ipcMain.handle('games:get', () => readGames());
```

---

## 🔧 开发指南

### 添加新的 IPC 接口

1. **main.js** - 添加处理函数

```javascript
ipcMain.handle('my:newFunction', (event, param) => {
  // 处理逻辑
  return result;
});
```

2. **preload.js** - 暴露接口

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ...
  myNewFunction: (param) => ipcRenderer.invoke('my:newFunction', param),
});
```

3. **index.html** - 调用接口

```javascript
const result = await window.electronAPI.myNewFunction(param);
```

### 添加新的 Steam API 功能

参考 `getSteamFriends`、`getSteamFriendsActivities` 等函数的实现。

### 自定义主题

在 `index.html` 中修改 CSS 变量：

```css
:root {
  --theme-color: #2563eb;
  --theme-hover: #1d4ed8;
}
```

---

## ❓ 常见问题

### Q: 游戏无法启动？

**A:** 检查以下几点：
1. 确认游戏路径正确
2. 确认游戏可执行文件存在
3. 尝试以管理员权限运行 Mizu
4. 检查路径是否包含特殊字符

### Q: Steam 同步失败？

**A:** 确认：
1. Steam API Key 正确
2. Steam ID 正确
3. 网络连接正常
4. 游戏在 Steam 库中

### Q: 封面无法显示？

**A:** 尝试：
1. 手动设置封面 URL
2. 确认 Steam AppId 正确
3. 检查网络连接

### Q: AI 功能无响应？

**A:** 检查：
1. API Key 是否正确
2. API 地址是否正确
3. 是否有足够的 API 配额
4. 网络连接是否正常

### Q: 如何备份数据？

**A:** 复制以下文件：
- `%APPDATA%/mizu/games.json` - 游戏库数据
- `localStorage` - 应用设置（在浏览器开发工具中导出）

---

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。

---

## 🙏 致谢

- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Steam Web API](https://developer.valvesoftware.com/wiki/Steam_Web_API) - Steam 数据接口
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- [Lucide](https://lucide.dev/) - 图标库
- [OpenAI](https://openai.com/) - AI 服务
- [Google Gemini](https://ai.google.dev/) - AI 服务

---

<div align="center">

**Mizu** - 让游戏管理更简单

Made with ❤️ by Mizu Team

</div>
