# 猫猫糕桌宠

一个 Windows 优先的 Electron 桌宠。当前版本使用本地猫猫糕贴纸，支持透明置顶窗口、拖拽、自定义大小、安静/活泼模式、点击反馈、右键菜单、托盘退出和本地 MockAgent 服务。

## 开发

```powershell
npm install
npm start
```

## 检查

```powershell
npm run check
```

## 打包

```powershell
npm run package:win
```

打包产物输出到 `dist/`，不提交到 Git。更新项目并重新打包时，先清理旧 `dist/`，再运行 `npm run package:win` 生成最新可执行文件。

## 上传到 GitHub

```powershell
npm run upload -- -Message "Update project"
```

上传脚本会执行 `git add .`、按消息提交、再 `git push`。被 `.gitignore` 排除的 `node_modules/`、`dist/`、临时文件和日志不会上传。

## Agent 预留

应用启动时会在 `127.0.0.1` 上打开随机端口的本地 HTTP 服务：

- `GET /api/v1/health`
- `GET /api/v1/state`
- `POST /api/v1/events`
- `POST /api/v1/say`

首版使用 MockAgent，不接外部 LLM 或语音服务。

## 注意事项

- 开发或对话结束前及时清理临时文件，例如 `tmp/`、日志文件和临时截图。
- `node_modules/`、旧 `dist/` 和其他构建产物不提交到 Git；需要运行桌宠时可以保留本地最新 `dist/`。
- 更新完成并检查无误后，使用 `npm run upload -- -Message "提交说明"` 自动提交并上传到 GitHub。
- 新增表情、动作或语音素材时，先放入对应预留目录，再更新相关 manifest 或加载逻辑。
- 本地 HTTP 服务只绑定 `127.0.0.1`，不要在首版中接入外部 LLM、远程 API 或语音服务。
