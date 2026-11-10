#!/bin/bash
set -e
cd "$(dirname "$0")"
echo '本地网页和查词服务：http://127.0.0.1:8001'
echo '注意：登录和单词库仍使用线上 Supabase，增删改会影响真实数据。'
echo '本地查词需在 .env.local 配置 DEEPL_API_KEY；不配置时仅显示英文。'
echo '请保持本窗口打开，按 Ctrl+C 停止。'
if [ ! -d node_modules ]; then npm ci; fi
npm run dev -- --open
