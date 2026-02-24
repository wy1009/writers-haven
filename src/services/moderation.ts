import Taro from '@tarojs/taro';
import type { CommentItem } from './jjwxc';

export interface ModerateRequestBody {
  apiKey: string;
  comments: Pick<CommentItem, 'id' | 'content'>[];
  prompt: string;
}

export interface ModerateResponse {
  maliciousCommentIds: string[];
}

const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';

/**
 * 在小程序端直接调用硅基流动。
 * 注意：apiKey 由用户在页面输入，不写死在代码里。
 */
export async function moderateComments(body: ModerateRequestBody): Promise<ModerateResponse> {
  const { apiKey, comments, prompt } = body;

  if (!apiKey) {
    throw new Error('请先填写硅基流动 API Key');
  }

  if (!Array.isArray(comments) || comments.length === 0) {
    return { maliciousCommentIds: [] };
  }

  const systemPrompt = `
你是一个内容审核助手。用户会给你一批评论，每条评论都有唯一 ID。

用户会定义“什么样的评论算有恶意”，你需要严格按照用户的定义进行判断。

请只输出 JSON，格式如下：
{
  "malicious_comment_ids": ["评论ID1", "评论ID2"]
}

其中 malicious_comment_ids 中只包含被你判定为“有恶意”的评论 ID。没有恶意的评论不要放进去。
`.trim();

  const commentListText = comments
    .map((c, idx) => `${idx + 1}. [id=${c.id}] ${c.content}`)
    .join('\n');

  const finalUserContent = `
用户对“恶意评论”的定义如下，请严格遵守：
${prompt}

下面是一批待审核的评论（可能为小说评论），请你找出其中所有“有恶意”的评论 ID，并按要求返回 JSON：

${commentListText}
`.trim();

console.log(finalUserContent, '======== systemPrompt')

  const resp = await Taro.request<any>({
    url: `${SILICONFLOW_BASE_URL}/chat/completions`,
    method: 'POST',
    header: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    data: {
      model: 'Qwen/Qwen2.5-72B-Instruct',
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalUserContent }
      ],
      temperature: 0,
      response_format: {
        type: 'json_object'
      }
    }
  });

  if (resp.statusCode !== 200 || !resp.data) {
    throw new Error(resp.errMsg || `硅基流动调用失败：${resp.statusCode}`);
  }

  const data = resp.data;
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    return { maliciousCommentIds: [] };
  }

  try {
    const parsed = JSON.parse(content);
    const ids = parsed?.malicious_comment_ids;
    if (!Array.isArray(ids)) {
      return { maliciousCommentIds: [] };
    }
    return { maliciousCommentIds: ids.map(String) };
  } catch (e) {
    console.error('解析模型返回 JSON 失败，原始 content:', content);
    return { maliciousCommentIds: [] };
  }
}


