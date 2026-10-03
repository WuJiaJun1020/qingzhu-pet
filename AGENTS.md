# qingzhu-pet 维护说明

- 独立 Windows 桌宠，入口为 app/main.cjs，不依赖 Pi 客户端。
- 原始视频与已提交的透明 PNG 不原地修改；处理工具另存结果。
- 通用处理算法不能硬编码人物坐标或某段动画的时间。
- 本地配置位于 数据；验收输出位于 tests/results，均不提交。
- 修改播放或交互后运行 npm test 和 npm run verify；修改 Python 工具后运行 npm run test:python。
- 新人物与动作通过资源清单扩展；当前界面尚未实现多角色切换。
- 发布前检查个人路径、凭据、历史文件和依赖是否误入提交。
- 原创代码采用 MIT；角色、图标、动画与第三方代码的授权范围参见 ASSETS.md。
