// ==UserScript==
// @name         Instagram Download Button (Enhanced)
// @name:zh-CN   Instagram 下载按钮（增强版）
// @namespace    https://github.com/zed76r/Instagram_Download_Button
// @version      2.1.4
// @description  Download or open media from Instagram posts, reels and stories.
// @description:zh-CN 下载或打开 Instagram 帖子、Reels 和快拍中的媒体。
// @author       ZhiYu (original); zed76r (fork maintainer)
// @match        https://www.instagram.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instagram.com
// @grant        GM_xmlhttpRequest
// @connect      instagram.com
// @connect      cdninstagram.com
// @connect      fbcdn.net
// @run-at       document-idle
// @homepageURL  https://github.com/zed76r/Instagram_Download_Button
// @license      MIT
// ==/UserScript==

/*
Based on Instagram Download Button by ZhiYu (y252328):
https://github.com/y252328/Instagram_Download_Button
https://greasyfork.org/scripts/406535-instagram-download-button

Original MIT license and copyright notice:

MIT License

Copyright (c) 2019 y252328

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(() => {
  'use strict';

  const PREFIX = 'igdl26';
  const WEB_APP_ID = '936619743392459';
  const NON_SHORTCODE_SEGMENTS = new Set(['audio']);
  const POST_PATH_RE = /^\/(?:p|reel|reels|tv)\/([^/?]+)/;
  const STORY_MEDIA_RE = /^\/stories\/[^/]+\/(\d+)/;
  const IG_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  const ACTION_ICONS = {
    comment: 'path[d^="M20.656 17.008"]',
    like: 'path[d^="M16.792 3.904"]',
    unlike: 'path[d^="M34.6 3.1c"]',
    repost: 'path[d^="M19.998 9.497"]',
    share: 'path[d^="M13.973 20.046 21.77 6.928"]',
    save: 'polygon[points="20 21 12 13.44 4 21 4 3 20 3 20 21"]',
  };

  // Accessible names cover icon revisions; geometry covers localized Instagram UI.
  const ACTION_LABELS = {
    like: ['Like', 'Unlike', '赞', '赞好', '取消赞', '讚', '取消讚'],
    comment: ['Comment', '评论', '留言'],
    share: ['Share', 'Send', '分享', '发送', '傳送'],
    repost: ['Repost', '转发', '轉發'],
    save: ['Save', 'Remove', 'Saved', '收藏', '取消收藏', '儲存', '移除'],
  };
  const INTERACTIVE = 'button, a, [role="button"], [role="link"], label';

  const SVG_OPEN = `
    <svg viewBox="0 0 24 24"
         width="24"
         height="24"
         fill="none"
         stroke="currentColor"
         stroke-width="2"
         stroke-linecap="round"
         stroke-linejoin="round"
         aria-hidden="true">
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>
      <path d="M14 4h6v6"/>
      <path d="m13 11 7-7"/>
    </svg>
  `;

  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24"
         width="24"
         height="24"
         fill="none"
         stroke="currentColor"
         stroke-width="2"
         stroke-linecap="round"
         stroke-linejoin="round"
         aria-hidden="true">
      <path d="M12 3v12"/>
      <path d="m7 10 5 5 5-5"/>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
    </svg>
  `;

  const SVG_SPINNER = `
    <svg viewBox="0 0 24 24"
         width="24"
         height="24"
         fill="none"
         stroke="currentColor"
         stroke-width="2"
         stroke-linecap="round"
         aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.25"/>
      <path d="M21 12a9 9 0 0 0-9-9"/>
    </svg>
  `;

  const style = document.createElement('style');

  style.textContent = `
    .${PREFIX}-btn {
      appearance: none; -webkit-appearance: none; display: inline-flex;
      align-items: center; justify-content: center; box-sizing: border-box;
      position: relative; z-index: 2; flex: 0 0 40px;
      width: 40px; height: 40px; min-width: 40px; padding: 8px; margin: 0;
      border: 0; border-radius: 8px; background: transparent; color: inherit;
      font: inherit; cursor: pointer; touch-action: manipulation;
      user-select: none; -webkit-user-select: none;
    }
    .${PREFIX}-btn svg { width: 24px; height: 24px; pointer-events: none; }
    .${PREFIX}-btn:hover { background: rgba(127,127,127,.14); }
    .${PREFIX}-btn:focus-visible { outline: 2px solid #0095f6; outline-offset: 2px; }
    .${PREFIX}-btn.${PREFIX}-busy { cursor: progress; opacity: .65; }
    .${PREFIX}-btn.${PREFIX}-busy svg { animation: ${PREFIX}-spin .7s linear infinite; }
    .${PREFIX}-btn.${PREFIX}-ok { color: #31a24c !important; }
    .${PREFIX}-btn.${PREFIX}-err { color: #ed4956 !important; }
    @keyframes ${PREFIX}-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .${PREFIX}-btn.${PREFIX}-busy svg { animation: none; }
    }
    #${PREFIX}-story-controls {
      position: fixed; bottom: max(88px, env(safe-area-inset-bottom));
      right: max(16px, env(safe-area-inset-right)); z-index: 2147483646;
      display: flex; gap: 4px; padding: 4px; border-radius: 12px;
      color: #fff; background: rgba(0,0,0,.72); pointer-events: auto;
    }
  `;
  document.head.appendChild(style);

  function visible(el) {
    if (!el?.getBoundingClientRect || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' &&
      r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < innerHeight && r.left < innerWidth;
  }

  function centerVisible(el) {
    if (!el || !el.getBoundingClientRect) {
      return false;
    }

    const r = el.getBoundingClientRect();
    const y = innerHeight / 2;

    return (
      r.width > 0 &&
      r.height > 0 &&
      r.top < y &&
      r.bottom > y
    );
  }

  function closestDirectChild(parent, node) {
    if (!parent || !node) {
      return null;
    }

    for (const child of parent.children) {
      if (child.contains(node)) {
        return child;
      }
    }

    return null;
  }

  function actionIcon(bar, kind) {
    const geometry = kind === 'like'
      ? `${ACTION_ICONS.like},${ACTION_ICONS.unlike}` : ACTION_ICONS[kind];
    const labels = (ACTION_LABELS[kind] || []).map(label => `[aria-label="${label}"]`);
    const selector = [geometry, ...labels].filter(Boolean).join(',');
    return [...bar.querySelectorAll(selector)].find(node =>
      !node.closest(`.${PREFIX}-btn`) && visible(node.closest('svg') || node));
  }

  function isActionBar(bar) {
    if (!bar || !visible(bar) || bar.children.length > 16 ||
        bar.closest(`${INTERACTIVE}, nav, header, form, [contenteditable="true"]`) ||
        bar.querySelector('textarea, input, [contenteditable="true"]')) return false;
    const r = bar.getBoundingClientRect();
    if (!((r.height <= 100 && r.width >= 90) || (r.width <= 140 && r.height >= 100))) return false;
    const icons = ['like', 'comment', 'share', 'repost', 'save']
      .map(kind => actionIcon(bar, kind));
    if (!icons[0] || icons.slice(1).filter(Boolean).length < 2) return false;
    // Each action must occupy its own cell. Never append inside Save or a comment.
    const cells = icons.filter(Boolean).map(icon => closestDirectChild(bar, icon));
    if (cells.some(cell => !cell) || new Set(cells).size < 3) return false;
    return true;
  }

  function findActionBars(root = document) {
    const bars = new Set();
    const seeds = [ACTION_ICONS.like, ACTION_ICONS.unlike,
      ...ACTION_LABELS.like.map(label => `[aria-label="${label}"]`)].join(',');
    for (const icon of root.querySelectorAll(seeds)) {
      if (!visible(icon.closest('svg') || icon)) continue;
      const scope = icon.closest('article, [role="dialog"]') ||
        (shortcodeFrom(location.pathname) ? icon.closest('main, [role="main"]') : null);
      if (!scope || !scope.querySelector('video, img')) continue;
      let bar = icon.parentElement;
      for (let hop = 0; bar && bar !== scope && hop < 8; hop++, bar = bar.parentElement) {
        if (!isActionBar(bar)) continue;
        // Keep a single toolbar even when one native action has nested wrappers.
        if (![...bars].some(existing => existing.contains(bar) || bar.contains(existing))) bars.add(bar);
        break;
      }
    }
    return [...bars];
  }

  function insertPointForBar(bar) {
    const icon = actionIcon(bar, 'share') || actionIcon(bar, 'repost') || actionIcon(bar, 'comment');
    return icon ? closestDirectChild(bar, icon) : null;
  }

  function buildButton(kind, reference, context = 'post') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${PREFIX}-btn ${PREFIX}-${kind}`;
    btn.dataset.context = context;
    btn.title = kind === 'download' ? 'Download media' : 'Open media in new tab';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = kind === 'download' ? SVG_DOWNLOAD : SVG_OPEN;
    btn._igdlIdleIcon = btn.innerHTML;
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
      btn.addEventListener(name, event => event.stopPropagation());
    }
    // Preserve native button Enter/Space activation while containing Instagram hotkeys.
    for (const name of ['keydown', 'keyup']) {
      btn.addEventListener(name, event => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      });
    }
    btn.addEventListener('click', event => handleAction(event, btn, kind), true);
    return btn;
  }

  function injectBar(bar) {
    const anchor = insertPointForBar(bar);
    if (!anchor) return;
    const existing = [...bar.children].filter(child => child.classList.contains(`${PREFIX}-btn`));
    if (existing.length === 2) {
      const open = existing.find(btn => btn.classList.contains(`${PREFIX}-open`));
      const download = existing.find(btn => btn.classList.contains(`${PREFIX}-download`));
      if (open && download) {
        if (anchor.nextElementSibling !== open || open.nextElementSibling !== download) {
          anchor.after(open, download);
        }
        return;
      }
    }
    existing.forEach(btn => btn.remove());
    anchor.after(buildButton('open', null), buildButton('download', null));
  }

  function isStoryPage() {
    return (
      location.pathname.startsWith(
        '/stories/'
      )
    );
  }

  function injectStoryControls() {
    const existing =
      document.getElementById(
        `${PREFIX}-story-controls`
      );

    if (!isStoryPage()) {
      existing?.remove();
      return;
    }

    if (existing) {
      return;
    }

    const media =
      findVisibleMedia(
        document,
        true
      );

    if (!media) {
      return;
    }

    const box =
      document.createElement(
        'div'
      );

    box.id =
      `${PREFIX}-story-controls`;

    box.append(
      buildButton(
        'open',
        null,
        'story'
      ),
      buildButton(
        'download',
        null,
        'story'
      )
    );

    document.body.appendChild(
      box
    );
  }

  function shortcodeFrom(
    pathname
  ) {
    const match =
      pathname?.match(
        POST_PATH_RE
      );

    if (
      !match ||
      NON_SHORTCODE_SEGMENTS.has(
        match[1]
      )
    ) {
      return null;
    }

    return match[1];
  }

  function shortcodeToMediaId(
    shortcode
  ) {
    if (!shortcode) {
      return null;
    }

    /*
     * New Instagram share/permalink IDs may append 28 characters
     * after the traditional shortcode.
     *
     * Example:
     * Dbo6gU5MjSIlt_kjvIJdV1NEfo-fh4re_V7Yrk0
     * -> Dbo6gU5MjSI
     */
    const code =
      shortcode.length > 28
        ? shortcode.slice(
            0,
            -28
          )
        : shortcode;

    let pk = 0n;

    for (
      const ch of code
    ) {
      const index =
        IG_B64.indexOf(
          ch
        );

      if (
        index < 0
      ) {
        return null;
      }

      pk =
        pk * 64n +
        BigInt(index);
    }

    return pk > 0n
      ? pk.toString()
      : null;
  }

  function shortcodeFromScope(
    scope
  ) {
    const fromUrl =
      shortcodeFrom(
        location.pathname
      );

    const fromDom = () => {
      if (
        !scope
          ?.querySelectorAll
      ) {
        return null;
      }

      for (
        const a of scope.querySelectorAll(
          'a[href]'
        )
      ) {
        const id =
          shortcodeFrom(
            new URL(
              a.href,
              location.origin
            ).pathname
          );

        if (id) {
          return id;
        }
      }

      return null;
    };

    const article =
      scope?.closest?.(
        'article'
      ) ||
      (
        scope?.tagName ===
          'ARTICLE'
          ? scope
          : null
      );

    const inDialog =
      !!scope?.closest?.(
        'div[role="dialog"]'
      );

    if (
      !article ||
      inDialog ||
      article.getAttribute(
        'role'
      ) === 'presentation'
    ) {
      return (
        fromUrl ||
        fromDom()
      );
    }

    return (
      fromDom() ||
      fromUrl
    );
  }

  function resolveScope(btn) {
    const article =
      btn.closest(
        'article'
      );

    if (article) {
      return article;
    }

    const bar =
      btn.parentElement;

    let node =
      bar;

    for (
      let hop = 0;
      hop < 10 &&
      node &&
      node !== document.body;
      hop++,
      node = node.parentElement
    ) {
      if (
        node.querySelector?.(
          'video'
        ) &&
        centerVisible(
          node
        )
      ) {
        return node;
      }
    }

    const dialog =
      btn.closest(
        'div[role="dialog"]'
      );

    if (dialog) {
      return dialog;
    }

    /*
     * Standalone permalink structural fallback.
     */
    if (
      /^\/(?:p|reel|reels|tv)\//.test(
        location.pathname
      )
    ) {
      const main =
        btn.closest(
          'main,[role="main"]'
        );

      if (main) {
        return main;
      }
    }

    return null;
  }

  function bestSrcFromSrcset(
    srcset
  ) {
    if (!srcset) {
      return null;
    }

    let best = null;
    let bestWidth = -1;

    for (
      const part of srcset.split(
        ','
      )
    ) {
      const match =
        part
          .trim()
          .match(
            /^(\S+)\s+(\d+)w$/
          );

      if (
        match &&
        Number(
          match[2]
        ) >
          bestWidth
      ) {
        best =
          match[1];

        bestWidth =
          Number(
            match[2]
          );
      }
    }

    return best;
  }

  function findVisibleMedia(
    scope = document,
    story = false
  ) {
    if (
      !scope
        ?.querySelectorAll
    ) {
      return null;
    }

    const candidates = [
      ...scope.querySelectorAll(
        'video,img'
      ),
    ].filter(el => {
      if (!visible(el)) {
        return false;
      }

      const r =
        el.getBoundingClientRect();

      if (
        r.width < 120 ||
        r.height < 120
      ) {
        return false;
      }

      if (
        story &&
        !centerVisible(
          el
        )
      ) {
        return false;
      }

      return true;
    });

    if (
      !candidates.length
    ) {
      return null;
    }

    const cx =
      innerWidth / 2;

    const cy =
      innerHeight / 2;

    candidates.sort(
      (a, b) => {
        const score =
          el => {
            const r =
              el.getBoundingClientRect();

            const area =
              r.width *
              r.height;

            const dx =
              (
                r.left +
                r.right
              ) /
                2 -
              cx;

            const dy =
              (
                r.top +
                r.bottom
              ) /
                2 -
              cy;

            return (
              area -
              Math.hypot(
                dx,
                dy
              ) *
                120
            );
          };

        return (
          score(b) -
          score(a)
        );
      }
    );

    return candidates[0];
  }

  function domMediaUrl(
    scope,
    story = false
  ) {
    const el =
      findVisibleMedia(
        scope ||
          document,
        story
      );

    if (!el) {
      return null;
    }

    if (
      el.tagName ===
      'VIDEO'
    ) {
      return (
        el.currentSrc ||
        el.src ||
        el.querySelector(
          'source[src]'
        )?.src ||
        null
      );
    }

    return (
      bestSrcFromSrcset(
        el.getAttribute(
          'srcset'
        )
      ) ||
      el.currentSrc ||
      el.src ||
      null
    );
  }

  function getAppId() {
    for (
      const script of document.querySelectorAll(
        'script'
      )
    ) {
      const match =
        script.textContent?.match(
          /"X-IG-App-ID":"(\d+)"/
        );

      if (match) {
        return match[1];
      }
    }

    return WEB_APP_ID;
  }

  const infoCache =
    new Map();

  async function fetchInfo(
    mediaId
  ) {
    if (!mediaId) {
      return null;
    }

    if (
      infoCache.has(
        mediaId
      )
    ) {
      return infoCache.get(
        mediaId
      );
    }

    const url =
      `/api/v1/media/${mediaId}/info/`;

    try {
      const response =
        await fetch(
          url,
          {
            credentials:
              'include',

            headers: {
              Accept: '*/*',

              'X-IG-App-ID':
                getAppId(),
            },
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `media info HTTP ${response.status}`
        );
      }

      const json =
        await response.json();

      infoCache.set(
        mediaId,
        json
      );

      if (
        infoCache.size >
        100
      ) {
        infoCache.delete(
          infoCache
            .keys()
            .next()
            .value
        );
      }

      return json;
    } catch (error) {
      console.warn(
        'IGDL26: media info lookup failed; using DOM fallback',
        error
      );

      return null;
    }
  }

  function bestImageCandidate(
    item
  ) {
    const list =
      item
        ?.image_versions2
        ?.candidates ||
      [];

    return (
      [...list]
        .sort(
          (a, b) =>
            (
              (b.width || 0) *
              (b.height || 0)
            ) -
            (
              (a.width || 0) *
              (a.height || 0)
            )
        )[0]?.url ||
      null
    );
  }

  function bestVideoCandidate(
    item
  ) {
    const list =
      item?.video_versions ||
      [];

    return (
      [...list]
        .sort(
          (a, b) =>
            (
              (b.width || 0) *
              (b.height || 0)
            ) -
            (
              (a.width || 0) *
              (a.height || 0)
            )
        )[0]?.url ||
      null
    );
  }

  function itemUrl(item) {
    return (
      bestVideoCandidate(
        item
      ) ||
      bestImageCandidate(
        item
      )
    );
  }

  function basenameToken(url) {
    try {
      const path =
        new URL(
          url,
          location.origin
        ).pathname;

      return decodeURIComponent(
        path.split(
          '/'
        ).pop() ||
          ''
      ).split(
        '.'
      )[0];
    } catch {
      return '';
    }
  }

  function dotIndex(scope) {
    if (
      !scope
        ?.querySelectorAll
    ) {
      return null;
    }

    const dots = [
      ...scope.querySelectorAll(
        'div._acnb'
      ),
    ];

    if (
      dots.length <
      2
    ) {
      return null;
    }

    const explicit = dots.findIndex(
      dot =>
        dot.getAttribute('aria-current') === 'true' ||
        dot.getAttribute('data-active') === 'true'
    );

    if (explicit >= 0) {
      return explicit;
    }

    const counts =
      new Map();

    for (
      const dot of dots
    ) {
      counts.set(
        dot.className,
        (
          counts.get(
            dot.className
          ) || 0
        ) + 1
      );
    }

    let common = null;
    let count = -1;

    for (
      const [
        cls,
        n,
      ] of counts
    ) {
      if (
        n > count
      ) {
        common =
          cls;

        count =
          n;
      }
    }

    // Two different dot classes alone do not identify the active slide.
    if (dots.length === 2 && counts.size === 2) {
      return null;
    }

    const odd =
      dots.findIndex(
        dot =>
          dot.className !==
          common
      );

    return odd >= 0
      ? odd
      : null;
  }

  function currentCarouselIndex(
    scope,
    items
  ) {
    const queryIndex =
      new URLSearchParams(
        location.search
      ).get(
        'img_index'
      );

    if (
      queryIndex &&
      Number(
        queryIndex
      ) >= 1 &&
      Number(
        queryIndex
      ) <=
        items.length
    ) {
      return (
        Number(
          queryIndex
        ) - 1
      );
    }

    const visibleUrl =
      domMediaUrl(
        scope
      );

    const token =
      basenameToken(
        visibleUrl
      );

    if (token) {
      const index =
        items.findIndex(
          item => {
            const itemToken =
              basenameToken(
                itemUrl(
                  item
                )
              );

            return (
              itemToken &&
              (
                itemToken.includes(
                  token
                ) ||
                token.includes(
                  itemToken
                )
              )
            );
          }
        );

      if (
        index >= 0
      ) {
        return index;
      }
    }

    const dot =
      dotIndex(
        scope
      );

    if (
      dot != null &&
      dot <
        items.length
    ) {
      return dot;
    }

    return 0;
  }

  async function resolvePostMedia(
    btn
  ) {
    const scope =
      resolveScope(
        btn
      );

    if (!scope) {
      throw new Error(
        'Could not resolve the post/reel containing this button'
      );
    }

    const shortcode =
      shortcodeFromScope(
        scope
      );

    const mediaId =
      shortcodeToMediaId(
        shortcode
      );

    const info =
      await fetchInfo(
        mediaId
      );

    const rootItem =
      info
        ?.items
        ?.[0] ||
      null;

    if (rootItem) {
      const items =
        rootItem.carousel_media ||
        [rootItem];

      const index =
        items.length > 1
          ? currentCarouselIndex(
              scope,
              items
            )
          : 0;

      const item =
        items[
          index
        ] ||
        items[0];

      const url =
        itemUrl(
          item
        );

      if (url) {
        return {
          url,
          item,
          rootItem,
          index,
        };
      }
    }

    const fallback =
      domMediaUrl(
        scope
      );

    if (!fallback) {
      throw new Error(
        'Could not find media URL in API or page DOM'
      );
    }

    return {
      url: fallback,
      item: null,
      rootItem: null,
      index: 0,
    };
  }

  async function resolveStoryMedia() {
    const match =
      location.pathname.match(
        STORY_MEDIA_RE
      );

    const mediaId =
      match?.[1] ||
      null;

    const info =
      await fetchInfo(
        mediaId
      );

    const item =
      info
        ?.items
        ?.[0] ||
      null;

    const url =
      itemUrl(
        item
      ) ||
      domMediaUrl(
        document,
        true
      );

    if (!url) {
      throw new Error(
        'Could not find current story media'
      );
    }

    return {
      url,
      item,
      rootItem: item,
      index: 0,
    };
  }

  function safeName(value) {
    return (
      String(
        value ||
        'instagram'
      )
        .replace(
          /[\\/:*?"<>|\x00-\x1f]/g,
          '_'
        )
        .replace(
          /\s+/g,
          ' '
        )
        .trim()
        .slice(
          0,
          160
        ) ||
      'instagram'
    );
  }

  function ymdhms(date) {
    const pad =
      value =>
        String(
          value
        ).padStart(
          2,
          '0'
        );

    return (
      `${date.getFullYear()}` +
      `${pad(date.getMonth() + 1)}` +
      `${pad(date.getDate())}_` +
      `${pad(date.getHours())}` +
      `${pad(date.getMinutes())}` +
      `${pad(date.getSeconds())}`
    );
  }

  function filenameFor(
    result,
    context
  ) {
    const item =
      result?.item ||
      result?.rootItem;

    let username =
      item?.user?.username;

    if (
      !username &&
      context ===
        'story'
    ) {
      username =
        location.pathname.split(
          '/'
        )[2];
    }

    if (!username) {
      username =
        'instagram';
    }

    const taken =
      item?.taken_at
        ? new Date(
            item.taken_at *
              1000
          )
        : new Date();

    const token =
      basenameToken(
        result.url
      ) ||
      item?.pk ||
      item?.id ||
      'media';

    const suffix =
      result.index
        ? `-${result.index + 1}`
        : '';

    return safeName(
      `${username}-${ymdhms(taken)}-${token}${suffix}`
    );
  }

  function extensionFromMime(
    mime,
    url
  ) {
    const byMime = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
    };

    const normalizedMime =
      String(mime || '')
        .split(';')[0]
        .trim()
        .toLowerCase();

    if (
      byMime[normalizedMime]
    ) {
      return byMime[
        normalizedMime
      ];
    }

    const match =
      String(
        url || ''
      )
        .split(
          '?'
        )[0]
        .match(
          /\.([a-zA-Z0-9]{2,5})$/
        );

    return match
      ? match[1]
          .toLowerCase()
      : 'bin';
  }

  function saveBlob(
    blob,
    baseName,
    sourceUrl
  ) {
    const extension =
      extensionFromMime(
        blob.type,
        sourceUrl
      );

    const anchor =
      document.createElement(
        'a'
      );

    anchor.download =
      `${baseName}.${extension}`;

    anchor.href =
      URL.createObjectURL(
        blob
      );

    document.body.appendChild(
      anchor
    );

    anchor.click();
    anchor.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          anchor.href
        ),
      60000
    );
  }

  async function downloadUrl(
    url,
    baseName
  ) {
    if (
      url.startsWith(
        'blob:'
      )
    ) {
      const response =
        await fetch(
          url
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `blob fetch HTTP ${response.status}`
        );
      }

      saveBlob(
        await response.blob(),
        baseName,
        url
      );

      return;
    }

    await new Promise(
      (
        resolve,
        reject
      ) => {
        try {
          GM_xmlhttpRequest({
            method: 'GET',

            url,

            responseType:
              'blob',

            onload:
              response => {
                if (
                  response.status < 200 ||
                  response.status >= 300
                ) {
                  reject(
                    new Error(
                      `download HTTP ${response.status}`
                    )
                  );

                  return;
                }

                try {
                  const blob = response.response;

                  if (
                    !blob ||
                    typeof blob.size !== 'number'
                  ) {
                    throw new Error(
                      'download returned no Blob'
                    );
                  }

                  if (/^(?:text\/html|application\/json)(?:;|$)/i.test(blob.type || '')) {
                    throw new Error(
                      'download returned a page instead of media'
                    );
                  }

                  saveBlob(
                    blob,
                    baseName,
                    url
                  );

                  resolve();
                } catch (error) {
                  reject(error);
                }
              },

            onerror:
              () =>
                reject(
                  new Error(
                    'GM_xmlhttpRequest failed'
                  )
                ),

            ontimeout:
              () =>
                reject(
                  new Error(
                    'download timed out'
                  )
                ),

            timeout:
              60000,
          });
        } catch (error) {
          reject(
            error
          );
        }
      }
    );
  }

  /*
   * Busy state:
   * replace the native action icon with a real spinner.
   * Do NOT rotate the download/open icon itself.
   */
  function setState(
    btn,
    state
  ) {
    btn.classList.remove(
      `${PREFIX}-busy`,
      `${PREFIX}-ok`,
      `${PREFIX}-err`
    );

    if (
      !btn._igdlIdleIcon
    ) {
      btn._igdlIdleIcon =
        btn.innerHTML;
    }

    btn.innerHTML =
      state === 'busy'
        ? SVG_SPINNER
        : btn._igdlIdleIcon;

    if (state) {
      btn.classList.add(
        `${PREFIX}-${state}`
      );
    }

    if (
      state &&
      state !== 'busy'
    ) {
      setTimeout(
        () => {
          btn.classList.remove(
            `${PREFIX}-${state}`
          );
        },
        1600
      );
    }
  }

  async function handleAction(
    event,
    btn,
    kind
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (
      btn.dataset.busy ===
      '1'
    ) {
      return;
    }

    btn.dataset.busy =
      '1';

    setState(
      btn,
      'busy'
    );

    /*
     * Open immediately before async work so Chromium
     * still treats it as a user gesture.
     */
    const popup =
      kind === 'open'
        ? window.open(
            'about:blank',
            '_blank'
          )
        : null;

    try {
      const context =
        btn.dataset.context;

      const result =
        context === 'story'
          ? await resolveStoryMedia()
          : await resolvePostMedia(
              btn
            );

      if (
        kind === 'open'
      ) {
        if (popup) {
          popup.opener =
            null;

          popup.location.replace(
            result.url
          );
        } else {
          window.open(
            result.url,
            '_blank',
            'noopener,noreferrer'
          );
        }
      } else {
        await downloadUrl(
          result.url,
          filenameFor(
            result,
            context
          )
        );
      }

      setState(
        btn,
        'ok'
      );
    } catch (error) {
      console.error(
        'IGDL26:',
        error
      );

      try {
        popup?.close();
      } catch {
      }

      setState(
        btn,
        'err'
      );

      btn.title =
        `Instagram Download Button: ${
          error.message ||
          error
        }`;

      setTimeout(
        () => {
          btn.title =
            kind === 'download'
              ? 'Download media'
              : 'Open media in new tab';
        },
        5000
      );
    } finally {
      btn.dataset.busy =
        '0';
    }
  }

  function scan() {
    try {
      if (
        !isStoryPage()
      ) {
        findActionBars()
          .forEach(
            injectBar
          );
      }

      injectStoryControls();
    } catch (error) {
      console.warn(
        'IGDL26: scan failed',
        error
      );
    }
  }

  let scheduled =
    false;

  let backstop =
    null;

  function scheduleScan() {
    if (scheduled) {
      return;
    }

    scheduled =
      true;

    const run = () => {
      if (
        !scheduled
      ) {
        return;
      }

      scheduled =
        false;

      clearTimeout(
        backstop
      );

      backstop =
        null;

      scan();
    };

    requestAnimationFrame(
      run
    );

    backstop =
      setTimeout(
        run,
        350
      );
  }

  const observer =
    new MutationObserver(records => {
      if (records.some(record => {
        if (record.target.closest?.(`.${PREFIX}-btn, #${PREFIX}-story-controls`)) return false;
        if ([...record.removedNodes].some(node => node.matches?.(`.${PREFIX}-btn`))) return true;
        const changed = [...record.addedNodes, ...record.removedNodes];
        return changed.some(node => node.nodeType === 1 &&
          !node.matches?.(`.${PREFIX}-btn, #${PREFIX}-story-controls`));
      })) scheduleScan();
    });

  observer.observe(
    document.body,
    {
      childList: true,
      subtree: true,
    }
  );

  window.addEventListener('resize', scheduleScan, { passive: true });

  window.addEventListener(
    'popstate',
    scheduleScan
  );

  window.addEventListener(
    'hashchange',
    scheduleScan
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        !document.hidden
      ) {
        scheduleScan();
      }
    }
  );

  window.addEventListener(
    'scroll',
    () => {
      scheduleScan();
    },
    {
      passive: true,
    }
  );

  /*
   * Instagram SPA navigation often changes URL
   * without firing popstate.
   */
  let lastUrl =
    location.href;

  setInterval(
    () => {
      if (
        location.href !==
        lastUrl
      ) {
        lastUrl =
          location.href;

        document
          .getElementById(
            `${PREFIX}-story-controls`
          )
          ?.remove();

        scheduleScan();
      }
    },
    800
  );

  scheduleScan();
})();
