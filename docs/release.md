# PI-YUN 发布指南

本指南针对 `Jason-24/pi-web-yun` 和 npm 包 `pi-yun`。仓库中的 `.github/workflows/publish.yml` 来自上游，发布任务限定在 `agegr/pi-web` 执行；向本仓库推送 `v*` 标签不会自动发布 npm 包、容器镜像或创建 GitHub Release。

## 发布前检查

1. 在干净的检出目录确认目标提交、工作区状态、`main` 与 `origin/main` 的关系，以及目标提交的 CI 结果。使用 `git fetch origin` 更新远端信息。
2. 确认 `package.json` 和 `package-lock.json` 中的版本一致，并检查目标 npm 版本和远端标签是否已存在：

   ```bash
   npm view pi-yun@<version> version --registry https://registry.npmjs.org/
   git ls-remote --tags origin refs/tags/v<version>
   ```

   查询失败不等于版本或标签不存在；区分未找到与网络、认证等错误。
3. 确认 npm 和 GitHub 的发布权限。运行 `npm test`、`npx tsc --noEmit` 和 `npm run lint`，并根据改动检查相关功能。
4. 从上一个 PI-YUN 发布版本到目标提交整理变更，准备发布说明。不要把上游标签当作本项目的发布记录。

## 版本、构建与 npm 发布

`package.json` 的 `npm run release` 当前依次执行 `npm ci`、`npm version patch --no-git-tag-version`、`npm run build` 和 `npm publish`。它会直接向 npm 发布，递增补丁版本并修改两个版本文件，但不会创建 Git 提交或标签。使用前应确认递增后的版本可用、npm 登录与权限正确，并在没有开发服务器的独立干净检出目录运行；构建会写入 `.next/`。

如果需要其他版本号，或希望在发布前先审查构建和版本文件，可在独立发布目录中分步执行：

```bash
npm ci
npm version <version> --no-git-tag-version
npm run build
npm publish
```

`npm publish` 是实际发布动作；发布成功后不能假定该版本可以重新使用。`prebuild` 会检查安装的 Next.js 版本，`prepack` 会检查构建产物。发布后确认 `npm view pi-yun@<version> version` 返回预期版本，并检查 npm 的 dist-tags。

## 提交、标签和 GitHub Release

将版本文件及准备发布的其他改动提交后，确认提交中的 `package.json` 版本与标签一致。创建附注标签并只推送本次标签：

```bash
git tag -a v<version> -m "Release v<version>"
git push origin main v<version>
```

不要使用 `git push --tags`：本地可能存在从上游或其他来源获取的标签。如果版本尚未改变，也可给已有目标提交打与其版本一致的标签；确保需要发布的全部修改都已提交并包含在标签内。

如需 GitHub Release，在标签推送后使用 GitHub 网页，或使用已登录且有权限的 GitHub CLI：

```bash
gh release create v<version> --repo Jason-24/pi-web-yun --verify-tag --title "v<version>" --notes-file <notes-file>
```

最后核对远端标签、GitHub Release 页面和 npm 版本。标签、GitHub Release 和 npm 发布是独立动作；未执行的步骤不会自动完成。Docker 使用本仓库的 [Docker 指南](./docker.md)自行构建，现有工作流不会为此 fork 自动发布镜像。
