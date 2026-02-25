import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Input, Textarea, Button, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { fetchAllCommentsOfWork, type CommentItem } from '@/services/jjwxc';
import { moderateComments } from '@/services/moderation';
import './index.scss';

const DEFAULT_PROMPT = `将评论视为“有恶意”的标准：
1. 带有人身攻击（辱骂、侮辱、嘲讽作者或读者）
2. 带有明显恶意引战、挑衅、阴阳怪气
3. 包含歧视性内容（地域、性别、群体等）
4. 纯粹为了发泄、抹黑，而非善意建议或中立评价

不是恶意评论的例子：
- 正常的吐槽、合理批评，但没有人身攻击或恶意攻击
- 语气稍微尖锐，但整体是就事论事的讨论

请严格按照以上标准判断。`;

interface DisplayComment extends CommentItem {
  isMalicious?: boolean;
}

const IndexPage: React.FC = () => {
  const STORAGE_KEY = 'writers-haven:lastInputs';
  const [workId, setWorkId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [allComments, setAllComments] = useState<DisplayComment[]>([]);
  const [safeComments, setSafeComments] = useState<DisplayComment[]>([]);
  const [maliciousIds, setMaliciousIds] = useState<string[]>([]);

  // 启动时从本地恢复上次输入
  useEffect(() => {
    try {
      const saved = Taro.getStorageSync(STORAGE_KEY) as
        | {
            workId?: string;
            apiKey?: string;
            chapterId?: string;
            prompt?: string;
          }
        | undefined;

      if (saved) {
        if (saved.workId) setWorkId(saved.workId);
        if (saved.apiKey) setApiKey(saved.apiKey);
        if (saved.chapterId) setChapterId(saved.chapterId);
        if (saved.prompt) setPrompt(saved.prompt);
      }
    } catch (e) {
      console.warn('读取本地配置失败', e);
    }
    // 仅在组件首次挂载时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 输入变化时自动保存到本地
  useEffect(() => {
    try {
      Taro.setStorageSync(STORAGE_KEY, {
        workId,
        apiKey,
        chapterId,
        prompt
      });
    } catch (e) {
      console.warn('保存本地配置失败', e);
    }
  }, [workId, apiKey, chapterId, prompt]);

  const loadPage = useCallback(
    async (page: number) => {
      if (!workId.trim()) {
        Taro.showToast({ title: '请先输入作品ID', icon: 'none' });
        return;
      }

      if (!apiKey.trim()) {
        Taro.showToast({ title: '请先输入硅基流动 API Key', icon: 'none' });
        return;
      }

      if (!prompt.trim()) {
        Taro.showToast({ title: '请先填写恶意评论定义', icon: 'none' });
        return;
      }

      setLoading(true);
      setAllComments([]);
      setSafeComments([]);
      setMaliciousIds([]);

      try {
        Taro.showLoading({ title: '拉取评论中…', mask: true });

        // 1. 拉取作品下指定章节（或整本书）的某一页评论
        const { comments, hasMore: pageHasMore } = await fetchAllCommentsOfWork({
          workId: workId.trim(),
          // 若章节 ID 留空，则不传 chapterId，走整本书评论链接：comment.php?novelid=...&page=1
          chapterId: chapterId.trim() || undefined,
          page
        });

        setCurrentPage(page);
        setHasMore(pageHasMore);
        setAllComments(comments);

        if (comments.length === 0) {
          Taro.hideLoading();
          Taro.showToast({ title: '未拉取到评论', icon: 'none' });
          return;
        }

        // 2. 送入后端，调用硅基流动进行“恶意评论”识别
        Taro.showLoading({ title: '大模型筛选中…', mask: true });

        const moderationResult = await moderateComments({
          apiKey: apiKey.trim(),
          comments: comments.map((c) => ({ id: c.id, content: c.content })),
          prompt
        });

        const maliciousSet = new Set(moderationResult.maliciousCommentIds || []);
        const withFlag: DisplayComment[] = comments.map((c) => ({
          ...c,
          isMalicious: maliciousSet.has(c.id)
        }));

        const safe = withFlag.filter((c) => !c.isMalicious);

        setMaliciousIds(Array.from(maliciousSet));
        setAllComments(withFlag);
        setSafeComments(safe);

        // 滚动到评论列表附近，方便直接查看结果
        Taro.nextTick(() => {
          try {
            Taro.pageScrollTo({
              selector: '#commentsAnchor',
              duration: 300
            });
          } catch (e) {
            console.warn('滚动到评论列表失败', e);
          }
        });

        Taro.hideLoading();
        Taro.showToast({
          title: `过滤完成：安全 ${safe.length} 条`,
          icon: 'success',
          duration: 2000
        });
      } catch (err: any) {
        console.error(err);
        Taro.hideLoading();
        Taro.showToast({
          title: err?.message || '操作失败',
          icon: 'none',
          duration: 3000
        });
      } finally {
        setLoading(false);
      }
    },
    [workId, apiKey, chapterId, prompt]
  );

  const handleStart = useCallback(async () => {
    await loadPage(1);
  }, [loadPage]);

  const handlePrevPage = useCallback(async () => {
    if (loading) return;
    if (currentPage <= 1) {
      Taro.showToast({ title: '已经是第一页', icon: 'none' });
      return;
    }
    await loadPage(currentPage - 1);
  }, [currentPage, loadPage, loading]);

  const handleNextPage = useCallback(async () => {
    if (loading) return;
    if (!hasMore) {
      Taro.showToast({ title: '已经是最后一页', icon: 'none' });
      return;
    }
    await loadPage(currentPage + 1);
  }, [currentPage, hasMore, loadPage, loading]);

  const totalCount = allComments.length;
  const maliciousCount = maliciousIds.length;
  const safeCount = safeComments.length;

  return (
    <View className='container'>
      <View className='card'>
        <Text className='section-title'>作品信息</Text>

        <View className='field-label'>硅基流动 API Key（仅保存在本机）</View>
        <Input
          className='field-input'
          // password
          placeholder='sk- 开头的 Key，由用户自行粘贴'
          value={apiKey}
          onInput={(e) => setApiKey(e.detail.value)}
        />

        <View className='field-label'>晋江作品 ID</View>
        <View className='field-input-row'>
          <View className='field-input field-input--with-clear'>
            <Input
              className='field-input-inner'
              placeholder='例如：1234567'
              value={workId}
              onInput={(e) => setWorkId(e.detail.value)}
            />
            {!!workId && (
              <View
                className='field-clear-btn'
                onClick={() => setWorkId('')}
              >
                <Text>×</Text>
              </View>
            )}
          </View>
        </View>

        <View className='field-label'>章节 ID（可选）</View>
        <Input
          className='field-input'
          placeholder='例如：1；留空则拉取整本书最近评论'
          value={chapterId}
          onInput={(e) => setChapterId(e.detail.value)}
        />
        <Text className='hint-text'>
          不填写章节 ID 时，会拉取整篇文最新 100 条评论，即直接展示在文章首页的评论，无其他限制；
          但填写章节 ID 时，只能填写非 VIP 章节 ID，因为 VIP 章节的评论需购买后才能查看。
        </Text>

        <View className='field-label'>恶意评论定义（Prompt，可自定义）</View>
        <Text
          className='hint-text'
          onClick={() => setShowPromptEditor((v) => !v)}
        >
          {showPromptEditor ? '收起定义' : '展开并编辑恶意评论定义'}
        </Text>
        {showPromptEditor && (
          <>
            <Textarea
              className='field-input field-textarea'
              style={{ minHeight: '180px' }}
              value={prompt}
              maxlength={-1}
              onInput={(e) => setPrompt(e.detail.value)}
              placeholder='在这里描述：你认为具有什么特征的评论是“有恶意”的'
            />

            <Text className='hint-text'>
              你可以根据需要自行修改上方 Prompt，例如只过滤“人身攻击 + 引战”，或加入针对某类内容的特殊规则。
            </Text>
          </>
        )}

        <Button
          className='primary-btn'
          type='primary'
          loading={loading}
          disabled={loading}
          onClick={handleStart}
        >
          拉取并过滤评论
        </Button>

        {totalCount > 0 && (
          <>
            <View className='summary-row'>
              <Text>共拉取评论 {totalCount} 条，其中</Text>
              <Text> 安全 {safeCount} 条</Text>
              <Text>，恶意 {maliciousCount} 条（已自动隐藏）。</Text>
            </View>
            <View className='pagination-row'>
              <Button
                size='mini'
                className='pagination-btn'
                disabled={loading || currentPage <= 1}
                onClick={handlePrevPage}
              >
                上一页
              </Button>
              <Text>第 {currentPage} 页</Text>
              <Button
                size='mini'
                className='pagination-btn'
                disabled={loading || !hasMore}
                onClick={handleNextPage}
              >
                下一页
              </Button>
            </View>
          </>
        )}
      </View>

      {safeComments.length > 0 && (
        <>
          <View id='commentsAnchor' />
          <Text className='section-title'>无恶意评论列表</Text>
          <View className='card' style={{ marginTop: '10px' }}>
            <ScrollView scrollY style={{ maxHeight: '68vh' }}>
              {safeComments.map((c) => (
                <View key={c.id} className='comment-item'>
                  <View className='comment-meta'>
                    <Text>
                      第 {c.chapterId || '—'} 章 · 楼层 {c.floor ?? '-'}
                    </Text>
                    {c.userName && <Text> · {c.userName}</Text>}
                    {c.createdAt && <Text> · {c.createdAt}</Text>}
                    <Text className='badge badge-safe'>安全</Text>
                  </View>
                  <View className='comment-content'>
                    <Text>{c.content}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
};

export default IndexPage;

