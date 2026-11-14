# 简体中文术语表

`src/luckgram/zh/*.ts` 里的译文，用词以 Telegram 官方简体中文语言包（`zh-hans-raw`）为准。
下表是 2026-11-14 从官方包里已有的译法抽出来的。**同一个概念只用一种译法**；加新译文前先查这里，
表里没有的词先到官方包里找（运行中的页面，IndexedDB `tweb-common` → `session` → `langPack`），找到后补进本表。

## 通用
| 英文 | 中文 | 说明 |
|---|---|---|
| you / your | 您 / 您的 | 官方包通篇用「您」，不用「你」 |
| Cancel / Done / Save / Remove / Delete | 取消 / 完成 / 保存 / 移除 / 删除 | Remove 与 Delete 不混用 |
| Edit / Copy / Share / Send / Search | 编辑 / 复制 / 分享 / 发送 / 搜索 | |
| Got it / OK | 知道了 / 好的 | |
| Settings | 设置 | |
| Privacy and Security | 隐私和安全 | 不是「隐私与安全」 |
| Notifications | 通知 | |
| Default / Auto | 默认 / 自动 | |
| … (ellipsis) | … | 用中文省略号，不用三个点 |

## 聊天
| 英文 | 中文 | 说明 |
|---|---|---|
| Chat / Chats | 聊天 | 不用「对话」「会话」 |
| Message | 消息 | 不用「信息」 |
| Saved Messages | 我的收藏 | |
| Group / Channel / Bot | 群组 / 频道 / 机器人 | |
| Community | 社群 | 官方包无此词（本客户端的功能），与安卓包「退出 %d 个社群」一致 |
| Topic / Forum | 话题 / 话题讨论 | |
| Folder | 文件夹 | 聊天分组也叫文件夹 |
| Archive | 归档 | |
| Pin / Mute / Unmute | 置顶 / 静音 / 取消静音 | |
| Forward / Reply / Quote / Mention | 转发 / 回复 / 引用 / 提及 | |
| Reaction | 表情回应 | 不单用「回应」 |
| Sticker / Emoji / GIF | 贴纸 / 表情符号 / GIF | emoji pack = 表情包 |
| Spoiler | 遮罩 | |
| Caption | 说明 | 媒体下方的文字 |
| Poll / Quiz / option / vote | 投票 / 问答 / 选项 / 投票 | |
| Checklist | 核对清单 | |
| Draft / Scheduled message | 草稿 / 定时消息 | |
| Link / Invite Link / Username | 链接 / 邀请链接 / 用户名 | |
| Photo / Video / File / Media | 图片（头像语境用「头像」）/ 视频 / 文件 / 媒体 | profile photo = 头像 |
| Voice message / Video message | 语音消息 / 视频消息 | |
| Slow Mode | 慢速模式 | |
| Mini App | 小程序 | |

## 人和权限
| 英文 | 中文 | 说明 |
|---|---|---|
| Contact | 联系人 | |
| Member / Subscriber / Admin / Owner | 成员 / 订阅者 / 管理员 / 所有者 | |
| Member tag | 自定义头衔 | |
| Permissions / Admin Rights | 权限 / 管理员权限 | |
| Restrict / Ban / Block / Report | 限制 / 封禁 / 屏蔽 / 举报 | |
| Profile / Bio | 个人资料 / 个人简介 | |
| online / last seen | 在线 / 最后上线 | |
| Anonymous | 匿名 | |

## 通话和动态
| 英文 | 中文 | 说明 |
|---|---|---|
| Call | 通话 | |
| Group call | 群组通话 | |
| Video Chat | 视频聊天 | 群组里的 |
| Live Stream | 直播 | |
| Camera / Microphone / Speakers / Screen | 相机 / 麦克风 / 扬声器 / 屏幕 | 官方包用「相机」，不用「摄像头」 |
| Story / Stories | 动态 | |
| Post (channel) | 帖子 | |
| Comment / Discussion | 评论 / 讨论 | |
| Views / Statistics | 浏览次数 / 统计数据 | |

## 账号和安全
| 英文 | 中文 | 说明 |
|---|---|---|
| Passcode | 锁定码 | Passcode Lock = 密码锁 |
| Password / Two-Step Verification | 密码 / 两步验证 | |
| Passkey | 通行密钥 | |
| Session / Device | 会话 / 设备 | Terminate session = 结束会话 |
| Phone number / Email | 手机号码 / 电子邮箱 | |
| Log out | 退出 | |

## 付费功能
| 英文 | 中文 | 说明 |
|---|---|---|
| Telegram Premium / Premium | Telegram Premium / 高级版 | 带链接标记 `[Telegram Premium]()` 的保留原文 |
| Stars | 星星 | %d Stars = %d 颗星星 |
| Gift / Collectible | 礼物 / 收藏品 | Limited-Edition = 限量版 |
| Boost / Level | 助推 / 等级 | |
| Giveaway | 抽奖活动 | |
| Wallet / Balance / Transaction | 钱包 / 余额 / 交易 | |
| Subscription / Refund / Invoice / Receipt | 订阅 / 退款 / 账单 / 收据 | |
| Paid | 付费 | Paid Content = 付费内容 |
| Ad / Sponsored message | 广告 / 赞助消息 | |
| Telegram Business | Telegram 企业版 | |

## 写法
- 占位符（`%s`、`%1$s`、`%d`、`%1$@`）、`**粗体**`、`[链接]()` 与英文一一对应；没有编号的 `%s` 不能调换顺序。
- 复数字符串写成对象，形式（`one_value`、`other_value`…）与英文相同，中文各形式内容一样。
- 中英文、数字之间留一个空格；句末用中文标点。
- 产品名写 Telegram Web 的地方照写，显示时会换成 Luckgram。
- 不含中文的字符串（`ID`、`LaTeX`、公式示例）不收。
