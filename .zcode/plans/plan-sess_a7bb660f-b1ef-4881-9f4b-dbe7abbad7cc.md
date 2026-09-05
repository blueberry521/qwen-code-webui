## 最终计划（方案二：保留 sseState + 落地 P2 UI）

用户已确认全部 UI 决策：**条件文字行**展示 + disconnected 时**加手动重连按钮** + 文案走 **i18n**。

这是**跨两个仓库、两个 PR 协调**的任务。后端 PR（data: 心跳）先合，前端 PR 后合。

---

### A. 后端 PR（open-ace/open-ace）—— 修复 🔴#1 根因

本地 clone `/Users/rhuang/workspace/open-ace`（当前 main，clean）建分支 `fix/sse-keepalive-data-event`：

**改动 1（主）** `app/routes/remote.py:907`
```python
# 改前
yield ": keepalive\n\n"
# 改后
yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
```

**改动 2（一致性）** `app/routes/autonomous.py:1589` —— 同样的 `: keepalive` → `data:`（同样的 stall 检测陷阱，避免将来踩坑）。

两处开头的 `yield ": connected\n\n"`（remote.py:844 / autonomous.py:1574）**保持不变**（仅用于让 Flask 立即发送响应头，不触发 onmessage）。

**测试**：后端无单测覆盖此分支（`tests/e2e/` 被 `norecursedirs` 排除）。新增 `tests/routes/test_remote_stream.py`，用 `app.test_client()` 直接消费 stream generator，断言空闲期产出 `data: {"type": "keepalive"}`（而非 `: keepalive`）。放 `tests/routes/`（被默认 pytest 收集）。

**流程**：建分支 → 改 2 处 + 测试 → 跑 `pytest tests/routes/test_remote_stream.py` 验证 → commit → push → `gh pr create`，标题 `fix(remote): emit keepalive as SSE data event for client stall detection`，关联 open-ace/open-ace#1511，说明配合前端 PR #196。

---

### B. 前端 PR（qwen-code-webui #196，复用 blueberry521 fork 分支）

`gh pr checkout 196 --detach` → 建本地分支 → 改以下 → `npx vitest run` 验证 → commit（author Leonie）→ force-push 到 fork 的 `fix/sse-reconnect`。

**改动 1 — `frontend/src/api/openace.ts` 的 onmessage（:805-818）**：识别 keepalive 不向下传递
```ts
es.onmessage = (event) => {
  resetStallTimer();
  if (event.data === "[DONE]") { ...; return; }
  // 新增：后端 data: keepalive 只用于 stall 检测，不是真实消息
  try {
    const parsed = JSON.parse(event.data);
    if (parsed?.type === "keepalive") return;
  } catch { /* 非 JSON，照常作为 SSE 行处理 */ }
  onLine(event.data);
};
```

**改动 2 — `frontend/src/hooks/useRemoteChat.ts`**：把 sseState 加进 return（保留，不再删）
```ts
return {
  session, isLoading, isStopping, sendMessage, startSession,
  connectSession, stopSession: stopSessionHandler, abortCurrentRequest,
  resetSession, reconnect, switchModel, pauseSession, resumeSession,
  sendPermissionResponse: handlePermissionResponse, error,
  sseState,  // ← 新增（P2：供 UI 显示连接状态）
};
```
（`:54` 声明和 `:217-219`/`:347-349` 的 onStateChange→setSseState **保留不动**，它们现在有消费者了。）

**改动 3 — `frontend/src/components/ChatPage.tsx`**：落地 P2 UI（条件文字行 + 重连按钮）
- 行 3 import 加 `ArrowPathIcon`：`import { ChevronLeftIcon, DocumentTextIcon, ServerIcon, ArrowPathIcon } from "@heroicons/react/24/outline";`
- 在现有 session 状态圆点块（:1604-1620）和 error 块（:1621）之间，插入新的条件行：
```tsx
{/* SSE connection state — P2 */}
{isRemoteWorkspace && remoteChat.session && remoteChat.sseState === "reconnecting" && (
  <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-600 dark:text-amber-400">
    <ArrowPathIcon className="h-3 w-3 animate-spin" />
    <span>{t("chat.sseReconnecting")}</span>
  </div>
)}
{isRemoteWorkspace && remoteChat.session && remoteChat.sseState === "disconnected" && (
  <div className="flex items-center gap-2 mt-1 text-xs text-red-500 dark:text-red-400">
    <span>{t("chat.sseDisconnected")}</span>
    {remoteMachineId && (
      <button
        onClick={() => remoteChat.reconnect(remoteMachineId, workingDirectory || "", selectedModel || undefined)}
        className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
      >
        {t("chat.reconnect")}
      </button>
    )}
  </div>
)}
```
（connected 状态**不显示任何东西**，避免常态噪音——这是用户选的"条件文字行"语义。重连按钮复用 :1628 的 onClick 签名和 danger-button 样式约定。）

**改动 4 — 4 个 i18n locale 文件**（`src/i18n/locales/{en,zh-CN,ja,ko}.json`）：在 `chat` 对象里 `reconnect` 附近新增两个键。键名遵循现有 `chat.*` 平铺约定：
- `en.json`：`"sseReconnecting": "Reconnecting…"`、`"sseDisconnected": "Disconnected"`
- `zh-CN.json`：`"sseReconnecting": "正在重新连接…"`、`"sseDisconnected": "已断开连接"`
- `ja.json` / `ko.json`：对应译文案（`"再接続中…"` / `"切断されました"`；`"재연결 중…"` / `"연결 끊김"`）

**改动 5 — 补测试 🟡#4**（新建 `frontend/src/api/__tests__/openace.reconnect.test.ts`）：
- `vi.stubGlobal("EventSource", ...)` 全局 mock（`createRemoteSessionStreamWithReconnect` 内部 `new EventSource(url)`，现有套件无此 mock）
- `vi.useFakeTimers()` + `vi.advanceTimersByTime()`（参考 `streamStallDetector.test.ts`）测：
  1. **退避递增**：连续 onerror → 重连间隔 1s→2s→4s…
  2. **maxRetries 耗尽触发单次 onError**：超上限只调一次 onError，不重复
  3. **stall 触发重连**：无数据超过 35s → close + scheduleReconnect
  4. **manual close 清理定时器**：`wrappedEs.close()` 后 advance 任意时间不再重连
  5. **keepalive 不传给 onLine**：推送 `{"type":"keepalive"}` → onLine 不被调用，但 stall 计时器被 reset
- `useRemoteChat.test.ts` 现有 mock 仍用旧 `createRemoteSessionStream`，本 PR 不破坏它（legacy 包装器保留）。如需补 sseState return 的断言，加一条"reconnecting 时 sseState==='reconnecting'"。

---

### C. 顺序与依赖

1. **先做后端 PR（A）**：建分支 + 改 + 测试 + push + 开 PR。
2. **再做前端 PR（B）**：改 4 类文件 + 测试 + force-push。
3. **回复 PR #196**：说明 🔴#1 改用后端 data: 心跳（附 open-ace PR 链接）、🟡#2 已核实非问题（缓冲+续传，重连不丢消息）、🟡#3 已落地 P2 UI（sseState return + ChatPage 条件文字行 + 重连按钮 + i18n）、🟡#4 已补 reconnect/stall/退避测试。标注"待后端 PR 合并后再合本 PR"。
4. **不立即合并**：后端 CI 需你 review；前端依赖后端。合并时机由你定。

---

### 需要你授权的 outward-facing 动作

- **open-ace 后端**：建分支、commit、push、开 PR（对另一个公开仓库的 outward 动作）。授权？
- **前端 PR**：force-push 到 blueberry521 的 fork（同 #200/#196 做法，maintainerCanModify=true）。继续授权？
- 本地跑测试：`pytest tests/routes/test_remote_stream.py`（open-ace）、`npx vitest run`（前端）。

确认后我开始执行。