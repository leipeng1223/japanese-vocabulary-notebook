# 我的单词本 · Supabase 云端版

这是独立的新版。原来的 `../japanese-vocab-notebook`、本地数据与桌面入口没有改动。

云端版包含邮箱登录、逐条保存、搜索排序、多选删除、随机复习、JSON/文本导入、JSON 备份，以及 Jisho + DeepL 查词。正式启用需要你创建自己的 Supabase 项目；代码不会自动创建付费资源或上传本地数据。

## 先预览

在此目录运行（Node.js 22 或更新版本）：

```sh
npm ci
npm run dev
```

打开 http://localhost:8001 。没有配置时显示配置引导；原本的本地版仍使用 8000。也可以双击本目录的 `启动云端版.command`，保持终端窗口打开。

## 1. 创建 Supabase 项目

1. 打开 https://supabase.com/dashboard ，注册或登录并创建一个项目。选择适合你的地区，妥善保存数据库密码。
2. 在项目 SQL Editor 中打开一个新查询，将 `supabase/migrations/202609180001_initial.sql` 全部粘贴进去执行一次。它会建立词条表、账号隔离规则、原子导入/批量删除、查词权限和每日额度。
3. 在项目设置中找到 Project URL 与 **publishable key**（也兼容旧版 anon public key）。填写本目录已创建的 `.env`：

```dotenv
VITE_SUPABASE_URL=https://你的项目编号.supabase.co
VITE_SUPABASE_ANON_KEY=你的publishable或anon公钥
```

这些是可公开的连接配置，权限由数据库 RLS 控制。不要把 service_role、数据库密码或 DeepL 密钥填入任何 `VITE_` 字段。

4. 在 Authentication 的 URL Configuration 中设置 Site URL 为 `http://localhost:8001`；发布后改成正式网站地址，按需要添加本地开发地址到允许的 Redirect URLs。
5. 重新启动 `npm run dev`，在页面注册账号。默认需要邮件确认；收到邮件并验证后回到页面登录。邮件服务的发送限制与生产 SMTP 配置请按 Supabase 控制台说明处理。

## 2. 启用云端查词

词条读写不依赖查词函数，完成第 1 步即可使用云端单词本。

先在 Supabase 控制台 Authentication → Users 找到你的用户 UUID，在 SQL Editor 执行以下语句（替换占位符）：

```sql
insert into public.dictionary_access(user_id)
values ('你的用户UUID') on conflict do nothing;
```

只有被允许的账号可以使用查词。当前限制为每账号每天 UTC 60 次查询尝试，防止公开注册消耗你的 DeepL 额度。可在 SQL 中调整，不是 DeepL 自身的服务限额。

Supabase CLI 已作为精确版本的开发依赖安装。执行 `npm ci` 后，在本目录运行：

```sh
npx supabase login
npx supabase link --project-ref 你的项目编号
npx supabase functions deploy dictionary
```

在控制台 **Edge Functions → Secrets** 设置：

- `DEEPL_API_KEY`：你的有效 DeepL API 密钥。只填在云端 Secrets，不放入网页代码。
- `ALLOWED_ORIGINS`：本地测试填写 `http://localhost:8001,http://127.0.0.1:8001`；发布时加入正式网站的 origin，例如 `https://你的账号.github.io`，不要加路径或末尾斜杠。多个地址用英文逗号分隔。

函数使用 `getUser(token)` 在服务器验证用户身份，随后通过数据库检查允许名单和额度。`config.toml` 中 `verify_jwt=false` 是为了在函数内部兼容不同签名密钥，**并不表示匿名用户可以查词**。

查询链路：汉字/假名/罗马音 → Jisho 写法、读音、英文义项 → DeepL 英译中。DeepL Free / Pro 根据密钥类型选择官方地址。没有结果时不调用翻译；翻译失败时保留英文参考，中文字段为空。例句目前由你手动补充。

## 3. 导入原来的单词

登录云端版后，选择“导入 → 从本地版迁移”，手动选择：

`../japanese-vocab-notebook/data/words.json`

页面先显示条数，点击导入后才上传到你当前登录的账号。原文件保持不变；单词、读音、释义、例句、备注和添加时间都会保留。旧 ID 不沿用，云端自动生成新 ID。同账号下相同“词面 + 读音”会跳过，重复导入不会覆盖云端的修改。

云端版与本地版是两份独立数据。迁移之后，本地版的新修改不会自动进入云端版。需要时可再次导入新增词，但不会自动合并已存在词条的修改。

## 4. 在其他电脑或手机使用

完成云端配置后，可以将前端部署为静态网站：

```sh
npm run build
```

只发布生成的 `dist/` 目录。它适合部署到 GitHub Pages 等静态网站服务；**上传代码到 GitHub 本身不等于发布网站**。本项目还包含云端函数和 SQL，不能只用 Pages 代替它们。

发布前设置构建环境里的上述两个 `VITE_` 公开配置；发布后更新 Supabase Auth 的 Site URL/Redirect URLs 和函数 `ALLOWED_ORIGINS`。GitHub Pages 项目路径可用，构建采用相对资源路径。

各设备打开正式网站并登录同一账号即可共享数据。你的 Mac 可以关机；数据库和查词函数都在云端运行。

## 同步和冲突规则

- 新增/编辑/删除按单词写入云端，不发送整本词库覆盖其他设备。
- 有 Realtime 更新订阅，并在窗口重新获得焦点、网络恢复和每 30 秒可见轮询时刷新。可随时点击“同步”。
- 同一词条带递增版本号。另一个设备已编辑/删除时，本次旧编辑会被拒绝，当前表单保留；请复制需要保留的内容，取消、同步后重新编辑。
- 批量删除检查全部词条版本，任何一个发生冲突则整批不删。JSON 导入也在一个事务中完成。
- 需要网络才能读取/保存云端数据。保存失败不会关闭表单或清空导入文本；当前没有离线编辑队列。当前页面数据不是持久备份，可定期点击“导出备份”。

## 验证

```sh
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

数据库测试使用本地嵌入式 PostgreSQL（PGlite）执行真实迁移、RLS、事务和额度函数；界面测试使用模拟的 Supabase HTTP 响应检查保存失败、重新加载、冲突、多选删除与 375/768/1280px 布局重叠，不使用真实账号或 DeepL 密钥。

当前本地工作区已经关联云端项目，初始迁移已登记为应用，`dictionary` 函数已部署并配置本地来源白名单，`DEEPL_API_KEY` 与实际用户的 `dictionary_access` 也已配置。真实账号已完成登录、云端读写、Jisho 查询和 DeepL 中文翻译验证；后续仍可用第二台设备和第二个账号补充验证跨设备传播与账号隔离。

## GitHub Pages

正式网页：<https://leipeng1223.github.io/japanese-vocabulary-notebook/>

推送到 `main` 后，GitHub Actions 会运行测试、构建 Vite 静态文件并部署到 GitHub Pages。仓库变量 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 提供可公开的前端连接配置；数据库密码、Supabase 服务端密钥和 `DEEPL_API_KEY` 不得提交到仓库。

官方参考：

- Supabase 行级权限：https://supabase.com/docs/guides/database/postgres/row-level-security
- 登录：https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- 云端密钥：https://supabase.com/docs/guides/functions/secrets
- 函数认证：https://supabase.com/docs/guides/functions/auth
