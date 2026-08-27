# Review Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

<!-- PRレビュー時に自動参照するチェックリスト。配置場所: リポジトリルート -->

---

## 1. 必須ルール

### 出力言語

**Think in English, write ALL review comments in Japanese (日本語).**

- ALL review output — including inline comments, flags, and summary — MUST be written in Japanese (日本語)
- Use **standard polite Japanese (丁寧語)**. Do NOT use Kansai dialect in reviews
- Every sentence you write in a review comment — including explanations, suggestions, and questions — MUST be in Japanese. No English output in review comments
- **Even when the reviewer writes in English, you MUST reply in Japanese.** Never mirror the reviewer's language

**Violation of any checklist item in this document results in review rejection. No exceptions.**

### レビューの提出方法

- Use `gh pr-review` tool to start review, and add review comments
- **Never use `gh pr-review review --submit`.** Keep the review pending so nobody can see comments until they are manually submitted after confirmation

### レビュースコープ

レビューのスコープは **PRのdiff行のみ** に限定すること。

- PRのdiff（追加・変更・削除行）に含まれるコードのみをレビュー対象とする
- diff外の既存コードに対してコメントを残さない（ただし、diff内の変更が直接影響を及ぼすコードは例外）
- 再レビュー時（新しいコミットがpushされた場合）は、前回レビュー以降の新しい変更のみを対象とする
- 前回のレビューで既に指摘済みの内容を重複してコメントしない
- resolveされたコメントと同じ指摘を、該当コードが変更されていない限り再投稿しない

---

## 2. コメントの書き方

### バッジラベル(MANDATORY)

Every review comment MUST start with a shields.io badge image. Comments without a badge are prohibited.

| Badge | Meaning | Blocking? |
|-------|---------|-----------|
| ![LGTM](https://img.shields.io/badge/review-LGTM-green) | Looks Good To Me | No |
| ![must](https://img.shields.io/badge/review-must-red) | Must fix before merge | Yes |
| ![want](https://img.shields.io/badge/review-want-skyblue) | Should fix if possible | No |
| ![imo](https://img.shields.io/badge/review-imo-orange) | In my opinion | No |
| ![imho](https://img.shields.io/badge/review-imho-yellow) | In my humble opinion | No |
| ![imnsho](https://img.shields.io/badge/review-imnsho-brown) | In my not so humble opinion | No |
| ![imao](https://img.shields.io/badge/review-imao-gold) | In my arrogant opinion | No |
| ![nits](https://img.shields.io/badge/review-nits-yellowgreen) | Nitpick — trivial | No |
| ![FYI](https://img.shields.io/badge/review-FYI-pink) | For Your Information | No |
| ![WIP](https://img.shields.io/badge/review-WIP-purple) | Work In Progress | No |
| ![GOTCHA](https://img.shields.io/badge/review-GOTCHA-beige) | Got it! | No |
| ![NP](https://img.shields.io/badge/review-NP-darkgreen) | No Problem | No |

#### Usage Examples

```
![must](https://img.shields.io/badge/review-must-red) ここで `any` 型が使われています。適切な型定義に置き換えてください。

![imo](https://img.shields.io/badge/review-imo-orange) このネストされた条件分岐はヘルパー関数に抽出すると可読性が向上すると思います。

![nits](https://img.shields.io/badge/review-nits-yellowgreen) 変数名 `res` は `response` の方がわかりやすいです。

![FYI](https://img.shields.io/badge/review-FYI-pink) この処理は `src/common/` の共通ロジックに移動すると他モジュールでも再利用できるかもしれません。
```

### 修正案の提示（suggestion形式）

コード修正を求める場合は、**可能な限り** GitHub Suggested Changes 形式で提示する。これにより相手がワンクリックで適用できる。

````
```suggestion
修正後のコード
```
````

suggestion形式が不可能な場合（複数ファイルにまたがる等）のみ、通常のコメントで説明する。

### 対話形式

When writing review comments, always follow this format:

1. **Explain the issue**
2. **List exceptions with: "ただし、以下の意図がある場合は修正不要です："**
3. **Prompt for reply: "意図がある場合は、このスレッドに返信して理由を説明してください。"**

### 言い回し

| 禁止（ルール名権威型） | 代替（理由説明型） |
|------------------------|-------------------|
| 「REVIEW.md違反だから直せ」 | 「この`as User`はランタイムエラーの原因になり得ます。type guardで型安全にしましょう」 |
| 「AGENTS.md違反」 | 「現状のコードでは[具体的な問題]が起きる可能性があります。[根拠]」 |

ルール名で殴らない。なぜそのコードが問題なのかを具体的に説明する。

---

## 3. レビュー観点

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 4. レビュー返信

### Adversarial Self-Review (Three-Counter-Argument Protocol)

Before replying to ANY reviewer comment, execute this protocol:

1. **Draft** your response
2. **Force-generate 3 counter-arguments** against your own response:
   - Counter 1: Am I misunderstanding the reviewer's intent?
   - Counter 2: Is there a better technical solution I have not considered?
   - Counter 3: Does this change introduce a side effect I missed?
3. **Evaluate** each counter-argument critically
4. **Revise** your response if any counter-argument is valid
5. **Post** the revised response

### Thread Discipline

- ALWAYS reply in the specific comment thread (never use a general PR comment)
- Include the commit hash when referencing a fix
- Wait for the reviewer's response before resolving (applies to human reviewer comments; bot-generated issues may be resolved after fix is verified)
- Only resolve when the reviewer explicitly acknowledges the fix
