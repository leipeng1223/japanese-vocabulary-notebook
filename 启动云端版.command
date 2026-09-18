#!/bin/zsh
set -e
cd "${0:A:h}"
if [[ ! -d node_modules ]]; then
  print '请先在此目录运行 npm ci 安装依赖。'
  read '?按回车退出'
  exit 1
fi
print '云端版地址：http://localhost:8001 （本地版仍在 8000）'
print '请保持此窗口打开。按 Control+C 停止。'
npm run dev -- --open
