# OSS 下载审计

采用 OSS 访问日志转存及 ECS 定时采集，不将安装包流量绕行带宽有限的业务服务器。业务 API、数据库和桌面更新入口不变。

源桶为 `gewu-staging-edu`。独立日志桶为 `gewu-download-audit-1079575960473975`，必须为私有、位于北京地域，日志前缀为 `access/`，原始日志 90 天后自动过期。不得在源桶中转存自己的访问日志，否则会循环产生新的日志。

服务器每小时采集一次，仅保存源桶 `desktop/` 对象的请求 ID、UTC 时间、对象名、方法、状态、实际下行字节数、对象大小、对象类型、声明的来源和客户端类型。查询月份以北京时间划分。请求 ID 去重，允许日志重复投递及增加尾部字段；解析失败不标记导入成功，后续会重试。数据库保存 400 天明细。

不保存原始 IP、完整 URL、签名参数、账号标识或 AccessKey。原始日志可能含有这些字段，因此日志桶必须私有，读取权限仅限采集身份；服务器凭据存储在 root-only 配置，由 systemd credential 提供给动态服务用户。

## 统计口径

- `requests`：实际收到的日志记录数量，包含 HEAD、失败请求等。
- `successful_get_responses`：成功 GET 响应数量，包含 200 和 206，不能直接等同于用户完成更新的次数。
- `full_object_responses`：200 响应且发送字节数等于非零对象大小的请求。
- `range_responses`：206 分段响应数量；分段、重试与不同用户的请求不会擅自合并成一次下载。
- `bytes_sent`：日志记录的实际下行字节数，包含错误响应；可按对象、类型和来源汇总。
- `kind`：安装包、差分映射、更新索引或其他文件。
- `declared_source`：只读取白名单查询参数 `x-gewu-source`，例如 `release-verification`、`desktop-update`、`manual`、`audit-probe`。该标记是请求方声明，不代表身份认证；没有可靠标记时保留 `unknown`，不把 curl 或匿名流量自动认定为更新。

官方日志以小时生成，预计 48 小时内投递，单个时间段可能迟到或不完整，且不记录中断请求。因此结果是已收到日志的统计，不能当作绝对完整的计费或客户端安装成功记录，也不能恢复开通前的九、十月下载次数。

## 运维与查询

初始化前先通过控制台为发布身份临时绑定 `config/oss-download-audit-setup-policy.json` 中的精确资源权限。执行 `python scripts/configure_oss_download_audit.py --apply`，验证私有桶、90 天生命周期与日志转存。随后必须将策略收敛为 `config/oss-download-audit-reader-policy.json`，不长期保留建桶和修改转存配置的权限。

部署：`python scripts/deploy_oss_download_audit.py --apply`。代码位于 `/opt/gewu-download-audit/collector.py`，配置位于 `/etc/gewu-download-audit.json`（0600），数据库位于 `/var/lib/gewu-download-audit/audit.sqlite3`。systemd timer 为 `gewu-download-audit.timer`，对应服务使用动态用户运行，不重启业务服务。

若 OSS 授权尚未完成，可执行 `python scripts/deploy_oss_download_audit.py --apply --stage-only` 先上传并回读验证采集器、凭据权限和 systemd 单元，不启用 timer。

2026-11-24 已完成阿里云安全验证后的策略绑定、私有桶创建、90 天生命周期和源桶日志转存配置，并正式启用每小时 timer。初始化策略已收敛为 `oss-download-audit-reader` v2，只保留日志读取、列举及源桶转存配置读取权限。验证匿名访问日志桶返回 403，初始化阶段的 `GetBucketInfo` 权限已移除；服务器 timer 为 active，采集服务 Result 为 success，凭据文件权限为 0600。

已发出带 `x-gewu-source=audit-probe` 的真实探测请求：更新索引 GET 200（372 字节）、安装包 HEAD 200、安装包分段 GET 206（1024 字节）。请求 ID 记录在 `output/oss-download-audit/probe-requests.json`。首次核验时尚未收到 OSS 的首批日志，月度统计为空且 `last_import_at` 为 null；不能把这一状态解释成实际没有下载，也未将模拟日志插入正式数据库。

服务器查询示例：

```sh
sudo python3 /opt/gewu-download-audit/collector.py status
sudo python3 /opt/gewu-download-audit/collector.py report --month 2026-11
sudo python3 /opt/gewu-download-audit/collector.py report --month 2026-11 --details --limit 100
sudo systemctl start gewu-download-audit.service
sudo journalctl -u gewu-download-audit.service -n 20 --no-pager
```

首次运行没有日志时，`last_import_at` 为 null。此时空记录表示尚未收到日志，不表示没有发生下载。部署与 OSS 配置回执存放在 `output/oss-download-audit/`。

完整运行核验：`python scripts/verify_oss_download_audit.py`。该命令重新检查云端转存目标、匿名访问隔离、权限收敛和服务器服务，并保存当前月统计到 `output/oss-download-audit/latest-monthly-report.json`。

测试：`python scripts/oss_download_audit.test.py`、`python scripts/configure_oss_download_audit.test.py`。测试覆盖完整/分段/HEAD/错误请求、北京时间月界、来源标记、去重、压缩日志、尾部扩展字段、隐私裁剪、失败重试、私有桶检查、拒绝覆盖既有转存目标及先配置保留再开启转存。

回退时先停止并禁用 `gewu-download-audit.timer`，恢复服务器配置快照；OSS 原转存配置保存在 `oss-before-*.json`。独立日志桶与本地 SQLite 数据不得随回退直接删除，以保留已经收集的审计证据。

官方依据：[日志转存与字段定义](https://help.aliyun.com/zh/oss/user-guide/logging)、[生命周期配置](https://help.aliyun.com/zh/oss/developer-reference/putbucketlifecycle)。
