# 青竹桌宠 · qingzhu-pet

一个轻量的独立 Windows 桌宠项目，用透明角色动画，让小人待机、阅读、御剑，也可以自由拖到桌面各处。

当前以「韩立 · 青竹小轩」为示例角色，已经接入五套动画。软件独立运行，不需要启动 Pi 客户端，也不依赖生成视频时使用的模型。

## 动画预览

| 呼吸眨眼 · 待机 | 取书阅读 | 小绿瓶 |
| :---: | :---: | :---: |
| ![待机动画](docs/previews/idle.gif) | ![阅读动画](docs/previews/reading.gif) | ![小绿瓶动画](docs/previews/bottle.gif) |

| 韩立与穆沛灵相拥 | 飞剑 |
| :---: | :---: |
| ![相拥动画](docs/previews/hug.gif) | ![飞剑动画](docs/previews/swords.gif) |

以上 GIF 用深色背景便于展示透明边缘和光效，预览为 12 fps；桌宠使用透明 PNG 帧，以原始 24 fps 播放。GIF 属于演示素材，不是实时录屏。

## 已实现

- 默认播放待机；每次待机结束，以可调概率触发其他动作，默认 30%。
- 随机动作每轮打乱顺序，依次覆盖各个动作，结束后回到待机。
- 支持自由拖动、缩放、暂停、循环、逐帧检查与进度定位。
- 配有黑白、棋盘格和自定义颜色的背景检查板，可重新居中找回桌宠。
- 支持原始透明帧与净化帧对照；四边和四角透明渐变，改善人物入场和退场的切边。
- 只缓存当前帧附近的少量图像，Windows 拖动采用仅移动位置的原生接口。
- 使用自定义窗口、托盘和启动快捷方式图标。

当前动画：待机约 6.58 秒、阅读约 20.04 秒、小绿瓶约 10.13 秒、相拥约 9.42 秒、飞剑约 13.67 秒。

## 启动

当前已验证平台为 Windows x64，需要 Node.js 22 或更新版本、npm。

```powershell
git clone https://github.com/WuJiaJun1020/qingzhu-pet.git
cd qingzhu-pet
npm ci
npm start
```

第一次安装会下载 Electron 和原生依赖。仓库保留当前五套动画所需的全部 PNG 资源，素材约 320 MiB；运行时不需要 Python、GPU、视频生成模型或网络连接。

希望日常启动不出现新的控制台窗口，可以使用以下启动入口，也可以创建快捷方式：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File .\launch.ps1
```

可选快捷方式生成脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-shortcut.ps1
```

角色可自由越过屏幕边缘；需要找回时，在背景检查板点击「重新居中」，或使用托盘的「找回桌宠」。再次启动同一个程序也会找回角色。配置保存在本地 `数据/`，不会上传到仓库。

## 代码与素材

```text
app/                 Electron 主进程、播放、拖动与界面
assets/              有效动画清单、透明 PNG、净化帧及图标
处理工具/            杂色净化、环境边缘渐隐、透明动画导入
scripts/             启动快捷方式与主页预览生成
tests/               播放模型、资源校验及真实窗口验收
docs/                使用说明、开发计划和预览 GIF
```

原始视频、旧动作、缓存、运行配置、处理模型、Electron 二进制和 `node_modules` 不纳入版本管理。

## 检查与素材处理

```powershell
npm test
npm run verify
```

`verify` 会启动隔离配置的真实窗口，检查播放、透明效果、随机动作、拖动、图标、背景板和四周渐隐；结束后自动退出。输出保存在 `tests/results/`，不会改变日常配置。该窗口验收目前针对 Windows。

仅使用素材处理工具时才需要 Python：

```powershell
python -m pip install -r .\处理工具\requirements.txt
npm run test:python
```

详见 [使用与素材导入说明](docs/使用说明.md)。本仓库包含透明素材的净化与导入代码；视频生成模型及双模型视频去白底流程尚未打包进本仓库。

## 后续计划

- **更多人物**：统一人物资源包结构，增加角色选择和切换，支持不同人物的尺寸、锚点和专属动作。
- **更多动作**：增加思考、打坐、围棋，以及被拎起和落下等交互动画，改善动作之间的衔接。
- **更灵活的调度**：为人物配置待机动作组、动作权重、触发条件和冷却时间。
- **更方便地导入**：增加素材导入界面、预览、完整性检查和透明边缘调节。
- **更方便地安装**：提供便携版或安装包，探索大体积动画资源的独立下载与更新。

目前多人物切换和上述新动作尚未实现，详细计划见 [Roadmap](docs/ROADMAP.md)。

## 协议

原创程序代码采用 [MIT License](LICENSE)。角色、图标、动画和演示图的授权范围单独说明，MIT 不替代已有角色或第三方素材的授权，见 [素材说明](ASSETS.md)。依赖保留各自许可证。
