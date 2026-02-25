import Taro from '@tarojs/taro';
import { TextDecoder as GbkTextDecoder } from 'text-encoding-gbk';

export interface CommentItem {
  id: string;
  chapterId: string;
  floor: number;
  content: string;
  userName?: string;
  createdAt?: string;
}

export interface FetchCommentsResponse {
  comments: CommentItem[];
  hasMore: boolean;
}

const JJ_REVIEW_BASE = 'https://www.jjwxc.net/comment.php';

function decodeJjwxcHtml(data: ArrayBuffer | string): string {
  if (typeof data === 'string') {
    return data;
  }

  try {
    const decoder = new GbkTextDecoder('gb18030');
    return decoder.decode(new Uint8Array(data));
  } catch (e) {
    try {
      const fallbackDecoder = new GbkTextDecoder('utf-8');
      return fallbackDecoder.decode(new Uint8Array(data));
    } catch {
      return '';
    }
  }
}

/**
 * 直接请求晋江 PC 站的某一页评论，并用简单规则解析 HTML。
 *
 * - 如果传入 chapterId，则访问章节评论页：
 *   https://www.jjwxc.net/comment.php?novelid={workId}&chapterid={chapterId}&page={page}
 * - 如果不传 chapterId，则访问整本书评论页：
 *   https://www.jjwxc.net/comment.php?novelid={workId}&page={page}
 */
async function fetchCommentsByPage(params: {
  workId: string;
  chapterId?: string;
  page: number;
}): Promise<FetchCommentsResponse> {
  const { workId, chapterId, page } = params;

  const url =
    chapterId && chapterId.trim()
      ? `${JJ_REVIEW_BASE}?novelid=${encodeURIComponent(
          workId
        )}&chapterid=${encodeURIComponent(chapterId.trim())}&page=${page}`
      : `${JJ_REVIEW_BASE}?novelid=${encodeURIComponent(workId)}&page=${page}`;

  const res = await Taro.request<ArrayBuffer | string>({
    url,
    method: 'GET',
    // 晋江评论页使用的是 GB18030/GBK 编码，这里以二进制拿到原始字节再自行转码
    responseType: 'arraybuffer'
  });

  if (res.statusCode !== 200 || !res.data) {
    throw new Error(res.errMsg || '晋江评论页请求失败');
  }

  const html = decodeJjwxcHtml(res.data as ArrayBuffer | string);

  const comments: CommentItem[] = [];

  /**
   * 解析思路（基于当前 PC 站评论页的大致结构，可能需要根据实际页面微调）：
   * - 每条评论通常是一块包含“正文 + [回复] [投诉]”等文字的区域。
   * - 可以粗略按“[回复]”进行 split，再在前面一段提取评论文本。
   *
   * 这里给出一个保守实现：按 “\[回复]” 拆分，再在包含“投诉”的块中抽出正文部分。
   * 如需更精细，可针对实际 HTML 结构做更准确的选择器解析。
   */

  const blocks = html.split('[\u56de\u590d]'); // "[回复]" 的 UTF-8 表示

  let floor = (page - 1) * 50; // 假定每页最多 50 条，用于生成近似楼层

  for (const block of blocks) {
    // 先去掉 <script>/<style> 整块，避免把 JS/CSS 当成正文
    const cleanedBlock = block
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    // 去掉 HTML 标签，得到纯文本
    const text = cleanedBlock
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;

    // 尝试从文本中抽取章节信息与时间信息（都非必需）
    let parsedChapterId = '';
    // PC 页中常见格式：“所评章节：1”，这里仅保留数字部分，前端再拼接“第 x 章”
    const chapterMatchNew = text.match(/(?:\u6240\u8bc4\u7ae0\u8282|当前章节)[：:]\s*(\d+)/); // 所评章节 / 当前章节
    if (chapterMatchNew && chapterMatchNew[1]) {
      parsedChapterId = chapterMatchNew[1];
    } else {
      const chapterMatch = text.match(/第(.+?)章/);
      if (chapterMatch && chapterMatch[1]) {
        parsedChapterId = chapterMatch[1];
      }
    }

    let createdAt = '';
    const timeMatch = text.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (timeMatch && timeMatch[1]) {
      createdAt = timeMatch[1];
    }

    // 过滤噪声：必须至少包含“发表时间”这一字段，才认为是真正的评论行
    // 避免底部“相关评论列表 / 热门评论”等被误判为一条条评论
    if (!text.includes('\u53d1\u8868\u65f6\u95f4')) {
      continue;
    }

    // 用户名：
    // 1. 优先从 HTML 中通过读者链接解析（onereader.php / oneauthor.php），最稳定
    // 2. 若失败，再尝试“网友：<a>用户名</a> 评论：”结构
    // 3. 再失败，则退回到纯文本正则，但排除“ 不看TA的 ”等操作项
    let userName = '';

    const readerLinkMatch = cleanedBlock.match(
      /<a[^>]+(?:onereader\.php|oneauthor\.php)[^>]*>([^<]+)<\/a>/i
    );
    if (readerLinkMatch && readerLinkMatch[1]) {
      userName = readerLinkMatch[1].trim();
    } else {
      const userByHtml = cleanedBlock.match(/网友[：:]\s*<a[^>]*>([^<]+)<\/a>/i);
      if (userByHtml && userByHtml[1]) {
        userName = userByHtml[1].trim();
      } else {
        const userByTag = text.match(/网友[：:]\s*([^\s\[]+?)\s*评论/);
        if (userByTag && userByTag[1]) {
          userName = userByTag[1].trim();
        } else {
          const userMatch = text.match(
            /([\u4e00-\u9fa5A-Za-z0-9_]+)\s*(?:\u8bc4\u8bba|\u8bf4|\u8868\u793a)/
          ); // 简单猜测
          if (userMatch && userMatch[1] && userMatch[1] !== '不看TA的') {
            userName = userMatch[1].trim();
          }
        }
      }
    }

    // 正文：只截取“所评章节”之后到“来自”之前的内容，尽量排除头尾无关信息
    let content = text;
    const chapterMarkerIndex = content.indexOf('\u6240\u8bc4\u7ae0\u8282'); // "所评章节"
    if (chapterMarkerIndex !== -1) {
      // 起始位置：先尝试按行切分，跳过包含“所评章节”的行
      const afterChapterLineBreak = content.indexOf('\n', chapterMarkerIndex);
      let start = afterChapterLineBreak !== -1 ? afterChapterLineBreak + 1 : chapterMarkerIndex;

      // 结束位置：优先截到“来自”前面
      let end = content.indexOf('\u6765\u81ea', start); // "来自"
      if (end === -1) {
        end = content.length;
      }

      content = content.slice(start, end).trim();
    } else {
      // 回退策略：去掉时间、章节等明显信息后，作为 content
      if (parsedChapterId) {
        // 删除类似“第1章”整段
        const chapterPattern = new RegExp(`第\\s*${parsedChapterId}\\s*章`, 'g');
        content = content.replace(chapterPattern, '');
      }
      if (createdAt) {
        content = content.replace(createdAt, '');
      }
      content = content.trim();
    }

    if (!content) {
      continue;
    }

    floor += 1;

    comments.push({
      id: `jj-${workId}-${page}-${floor}`,
      chapterId: parsedChapterId || '未知章节',
      floor,
      content,
      userName: userName || undefined,
      createdAt: createdAt || undefined
    });
  }

  /**
   * 是否还有下一页：
   * - WAP 页底部通常有“1 2 3 ... 下一页”等分页链接，可以通过是否出现“下一页”或当前页号判断。
   */
  const hasMore = /[\u4e0b\u4e00\u9875]/.test(html); // 是否包含“下一页”

  return {
    comments,
    hasMore
  };
}

/**
 * 拉取指定章节、指定页的一页评论。
 * 始终只返回单页结果，由调用方自行处理分页。
 */
export async function fetchAllCommentsOfWork(params: {
  workId: string;
  chapterId?: string;
  page?: number;
}): Promise<FetchCommentsResponse> {
  const { workId, chapterId, page = 1 } = params;

  return fetchCommentsByPage({
    workId,
    chapterId,
    page
  });
}


