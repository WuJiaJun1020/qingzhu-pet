# 青竹桌宠 · qingzhu-pet

一个轻量的独立 Windows 桌宠项目，用透明角色动画，让小人待机、阅读、御剑，也可以自由拖到桌面各处。

本地客户端当前支持 26 位角色、109 套动画，包含待机、专属动作、挥手及拖拽与下落交互。软件独立运行，不需要启动 Pi 客户端，也不依赖生成视频时使用的模型。

## 动画预览

| 呼吸眨眼 · 待机 | 取书阅读 | 小绿瓶 |
| :---: | :---: | :---: |
| ![待机动画](docs/previews/idle.gif) | ![阅读动画](docs/previews/reading.gif) | ![小绿瓶动画](docs/previews/bottle.gif) |

| 韩立与慕沛灵相拥 | 飞剑 |
| :---: | :---: |
| ![相拥动画](docs/previews/hug.gif) | ![飞剑动画](docs/previews/swords.gif) |

以上 GIF 用深色背景便于展示透明边缘和光效，预览为 12 fps；桌宠使用透明无损 WebP 帧，按每段素材的原始帧时序播放。GIF 属于演示素材，不是实时录屏。

## 已实现

- 内置透明帧修补工具：逐帧选择、单像素橡皮与恢复笔刷、最高 3200% 放大、竖线前后对比、撤销和重做。完成一批修补后统一保存并应用于播放，原始帧不变。
- 支持 26 位角色的按需下载与切换，各角色拥有独立动作池；角色清单见 `assets/character-packs.json`。
- 默认播放待机；每次待机结束，以可调概率触发其他动作，默认 30%。
- 随机动作每轮打乱顺序，依次覆盖各个动作，结束后回到待机。
- 拖动开始进入悬垂姿态，产生移动时播放一次被抓动画，停住保持尾帧；松手播放下落并返回自身待机。
- 支持自由拖动、10%–100% 大小、暂停、循环、逐帧检查与进度定位；100% 对应原素材像素。
- 常用设置集中显示，动画检查可展开；默认不打开背景检查板。
- 配有黑白、棋盘格和自定义颜色的背景检查板，可重新居中找回桌宠。
- 统一使用净化透明帧；四边和四角透明渐变，改善人物入场和退场的切边。
- 只缓存当前帧附近的少量图像，Windows 拖动采用仅移动位置的原生接口。
- 使用自定义窗口、托盘和启动快捷方式图标。
- 人物按需下载、SHA-256 校验并独立安装，支持取消、重试和本地包导入；安装后立即可切换。

韩立拥有 3 套待机及阅读、小绿瓶、相拥、飞剑、被抓、下落；其余 25 位角色各有待机、被抓、下落、挥手。呼吸眨眼待机保留 132 帧，约 5.5 秒。

## 下载与安装

支持 Windows 10 / 11 x64。普通用户下载 [青竹桌宠 0.2.0 安装包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/v0.2.0/qingzhu-pet-0.2.0-windows-x64-setup.exe)，双击安装后，从桌面或开始菜单打开「青竹桌宠」。无需安装 Node.js、Python，不需要显卡或视频生成模型。安装包未进行代码签名，Windows 可能显示未知发布者提示。

完整版本说明与校验文件见 [软件发布页](https://github.com/WuJiaJun1020/qingzhu-pet/releases/tag/v0.2.0)。默认内置韩立的 9 套动画；其余人物在设置中点击「人物资源」即可公开下载，安装后离线播放。

安装版的设置、下载人物和修补记录保存在 `%APPDATA%/青竹桌宠/`，软件更新后保留，卸载不会主动删除。以前通过源码运行的 `数据/` 不会自动迁移；完全退出两个版本后，可将其中内容复制到此目录。

## 人物资源下载

以下 26 个人物包均公开下载，无需登录；包含该角色当前全部动作，使用净化透明无损 WebP。韩立已内置，通常不用另外下载。下载 `.qzpet` 后，在设置 → 人物资源 →「从文件导入」安装，不需要手动解压。

| 人物 | 动作 | 包大小 | 下载链接 |
| --- | --- | --- | --- |
| 韩立 | 9 套 | 112.8 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/hanli-432187716a36.qzpet) |
| 梅凝 | 4 套 | 14.6 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/meining-93845ed52189.qzpet) |
| 墨彩环 | 4 套 | 17.5 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/mocaihuan-142dee967d0b.qzpet) |
| 慕沛灵 | 4 套 | 17.7 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/mupeiling-912ded93d2fb.qzpet) |
| 南宫婉 | 4 套 | 15.0 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/nangongwan-dad3380e0445.qzpet) |
| 银月 | 4 套 | 16.9 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/yinyue-a0384fa6a18a.qzpet) |
| 元瑶 | 4 套 | 15.5 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/yuanyao-fd64f5a02a05.qzpet) |
| 紫灵 | 4 套 | 15.9 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/ziling-2b9508243668.qzpet) |
| 陈巧倩 | 4 套 | 13.5 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/chenqiaoqian-6973135f6aab.qzpet) |
| 董萱儿 | 4 套 | 16.6 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/dongxuaner-1c9e3ebca306.qzpet) |
| 范静梅 | 4 套 | 16.0 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/fanjingmei-db30c20ed578.qzpet) |
| 公孙杏 | 4 套 | 14.5 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/gongsunxing-5c773d6a49ec.qzpet) |
| 菡云芝 | 4 套 | 16.2 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/hanyunzhi-bab99240eedf.qzpet) |
| 李缨宁 | 4 套 | 13.9 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/liyingning-7763aa794ec3.qzpet) |
| 凌玉灵 | 4 套 | 13.7 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/lingyuling-9e410d85e6cc.qzpet) |
| 柳玉 | 4 套 | 15.1 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/liuyu-2ba285894bdd.qzpet) |
| 慕兰圣女 | 4 套 | 17.7 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/mulanshengnv-75e8c816b00d.qzpet) |
| 南宫阙 | 4 套 | 14.6 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/nangongque-039fef346152.qzpet) |
| 宋玉 | 4 套 | 15.7 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/songyu-a49106463c1b.qzpet) |
| 邰夫人 | 4 套 | 14.2 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/taifuren-0d75b819a1ef.qzpet) |
| 温夫人 | 4 套 | 14.5 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/wenfuren-4446a653e32c.qzpet) |
| 文思月 | 4 套 | 17.7 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/wensiyue-e7b22bf1a441.qzpet) |
| 辛如音 | 4 套 | 15.4 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/xinruyin-69817fb372ff.qzpet) |
| 妍丽 | 4 套 | 15.2 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/yanli-6b80606c7092.qzpet) |
| 燕如嫣 | 4 套 | 14.7 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/yanruyan-a5c30887dc7d.qzpet) |
| 卓如婷 | 4 套 | 21.1 MiB | [下载人物包](https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/characters-20261005/zhuoruting-b9cedbf977f0.qzpet) |

人物包合集与下载清单见 [人物资源发布页](https://github.com/WuJiaJun1020/qingzhu-pet/releases/tag/characters-20261005)。资源包安装时校验 SHA-256 与完整性；角色素材授权范围见 [ASSETS.md](ASSETS.md)。

## 从源码运行与构建

开发者需要 Node.js 22 或更新版本与 npm：

```powershell
git clone --depth 1 https://github.com/WuJiaJun1020/qingzhu-pet.git
cd qingzhu-pet
npm ci
npm start
```

源码模式数据位于项目的 `数据/`。生成 Windows x64 安装包：

```powershell
npm run dist:win
```

产物位于 `dist/`，只包含软件、内置韩立与下载清单，不包含本地配置、已安装人物、原始视频或历史素材。

角色可自由越过屏幕边缘；需要找回时，在背景检查板点击「重新居中」，或使用托盘的「找回桌宠」。再次启动同一个程序也会找回角色。配置保存在本地 `数据/`，不会上传到仓库。

## 手动修补透明帧

默认柔化半径为 3 像素。先逐帧自动去白，再点击「统一柔化本批修补帧」，处理本次打开过的已修补帧，各帧可撤销；最后统一保存并应用。工具区紧凑分组；缩放、背景和前后对比位于画布上方，画布在可用区域居中，放大后可点击「居中」重新定位。

默认使用「自动去白」，点击残留白色直接修补，无需逐次确认。识别半径和颜色容差可调；误删可撤销或恢复。切换帧保留修改，完成一批后再统一保存并应用到桌宠。

在设置中展开「动画检查」，点击「修补透明帧」。选择角色、动作和帧，用 1 像素笔刷清除残留背景；也可调大笔刷连续涂抹。放大后按住空格或鼠标中键拖动画布，Ctrl + 滚轮缩放。

左侧为修改前，右侧为修改后，左右拖动竖向分隔线比较；关闭「前后对比」可以编辑整个画面。Ctrl + Z 撤销，Ctrl + Shift + Z 重做；误删的原有像素可用「恢复像素」笔刷补回。「恢复当前原帧」取消这一帧的全部修补。

切帧保留未保存修改，点击「保存并应用全部修改」或 Ctrl + S，将所有修改过的帧统一保存，桌宠只刷新一次。未保存就关闭窗口会提示确认。修补记录保存在本地 `数据/frame-edits/`，采用压缩像素记录和小型蒙版，不改动人物包或原始 WebP。人物资源更新后，原帧哈希发生变化时旧修补不会自动套用。打开工具会暂停桌宠，完成后可在设置中恢复播放。

### 柔和擦除与局部自动去白

默认使用 3 像素柔和笔刷，中心擦除、边缘渐变透明；强度可调，支持恢复和撤销。需要精确删除时关闭「柔和边缘」并设为 1 像素。已有硬擦除的帧可用「柔化已擦除边缘」，默认羽化 3 个原始像素，可单独撤销。

默认选中「自动去白」，直接点击残留白色，工具只识别指定半径内与点击位置连通、颜色相近的浅色区域，；去白后可单独或批量柔化边缘。点击直接修补当前帧，可撤销并用对比条检查；切换帧继续修补，完成一批后点击「保存并应用全部修改」，所有脏帧一起保存，桌宠仅刷新一次。浅色服装附近请缩小识别范围或降低颜色容差，该工具依靠颜色和连通性，不能从语义上区分白衣与白背景。

旧版完全擦除记录会自动兼容，新增半透明修补使用压缩透明度记录，原始素材保持不变。

## 代码与素材

```text
app/                 Electron 主进程、播放、拖动与界面
assets/              内置人物净化帧、下载清单及图标
数据/characters/     按需安装的人物（本地数据，不提交）
处理工具/            杂色净化、环境边缘渐隐、透明动画导入
scripts/             启动快捷方式与主页预览生成
tests/               播放模型、资源校验及真实窗口验收
docs/                使用说明、开发计划和预览 GIF
```

原始视频、原始 PNG、旧动作、历史备份、缓存、运行配置、处理模型、Electron 二进制和 `node_modules` 不纳入版本管理。

## 检查与素材处理

```powershell
npm test
npm run verify
```

`verify` 会启动隔离配置的真实窗口，检查验收数据目录中已安装的人物、动画透明效果、逐帧与尾帧、随机动作和拖拽交互；未装人物时检查内置韩立。`npm run verify:legacy` 提供原有图标、背景板与四周渐隐等验收。结束后自动退出。输出保存在 `tests/results/`，不会改变日常配置。该窗口验收目前针对 Windows。

`npm run verify:download` 使用全新隔离目录验证 GitHub 实际下载、取消重试、安装、切换和拖拽，需要网络。

仅使用素材处理工具时才需要 Python：

```powershell
python -m pip install -r .\处理工具\requirements.txt
npm run test:python
```

详见 [使用与素材导入说明](docs/使用说明.md)。本仓库包含透明素材的净化与导入代码；视频生成模型及双模型视频去白底流程尚未打包进本仓库。

## 资源体积

先将 PNG 无损转换为 WebP，再移除发布资源中的原始对照帧，此前八位角色的全套帧资源约 224.3 MiB。默认只附带韩立，其余人物分包下载。净化帧的像素、透明度、分辨率、帧数和时长保留；原始素材移出运行目录，本地留档。

新增动作通过导入工具直接生成净化无损 WebP；制作人员可运行 `npm run pack:characters` 生成独立人物包。原始 PNG 另行保留，不进入新版本上传范围。历史提交中的 PNG 仍会影响完整克隆体积，压缩本次资源不会清除 Git 历史。详见 [空间优化记录](docs/空间优化.md)。

## 后续计划

- **更多人物**：继续增加人物与专属动作，扩展资源包导入、尺寸和显示锚点配置。
- **更多动作**：增加打坐、围棋和更多双人互动，改善不同动作之间的衔接。
- **更灵活的调度**：为人物配置待机动作组、动作权重、触发条件和冷却时间。
- **更方便地导入**：增加素材导入界面、预览、完整性检查和透明边缘调节。
- **资源与更新管理**：完善人物资源版本管理、安装包升级和资源迁移。

Windows 安装包、多人物下载与切换、思考、被抓与下落、挥手已接入；其余计划见 [Roadmap](docs/ROADMAP.md)。

## 协议

原创程序代码采用 [MIT License](LICENSE)。角色、图标、动画和演示图的授权范围单独说明，MIT 不替代已有角色或第三方素材的授权，见 [素材说明](ASSETS.md)。依赖保留各自许可证。
