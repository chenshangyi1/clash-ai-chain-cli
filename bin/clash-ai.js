#!/usr/bin/env node

const { main } = require('../src/cli');

main(process.argv.slice(2)).catch((error) => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
