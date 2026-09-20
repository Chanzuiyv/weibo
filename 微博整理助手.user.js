// ==UserScript==
// @name         微博整理助手（检测桥）
// @namespace    wb-org-bridge
// @version      1.0.0
// @description  给「微博数据管理系统」（index.html）提供链接检测与正文抓取能力：浏览器直连微博访客接口，无需 Python、无需代理服务器。Windows / Mac 通用。
// @author       内容组
// @match        *://*/*
// @match        file:///*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      m.weibo.cn
// @connect      weibo.com
// @connect      weibo.cn
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    function rand16() {
        let s = '';
        for (let i = 0; i < 16; i++) s += '0123456789abcdef'[Math.random() * 16 | 0];
        return s;
    }

    // GM 请求 → Promise
    const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
    function wxhr(opt) {
        const headers = Object.assign({ 'User-Agent': MOBILE_UA }, opt.headers || {});
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest(Object.assign({
                method: 'GET',
                timeout: 20000,
                headers: headers,
                onload: r => resolve(r),
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(new Error('timeout')),
            }, opt, { headers: headers }));
        });
    }

    // 访客身份缓存（10 分钟），与本地代理同思路
    let vCache = { at: 0, sub: '', subp: '' };

    async function visitorIdentity() {
        if (vCache.sub && Date.now() - vCache.at < 10 * 60 * 1000) return vCache;
        const body = 'cb=visitor_gray_callback&ver=20250916'
            + '&request_id=' + rand16()
            + '&tid=&from=weibo&webdriver=false'
            + '&rid=' + Date.now()
            + '&return_url=' + encodeURIComponent('https://m.weibo.cn/');
        const g = await wxhr({
            method: 'POST',
            url: 'https://m.weibo.cn/visitor/genvisitor2',
            data: body,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://m.weibo.cn/',
            },
        });
        const t = g.responseText || '';
        const i = t.indexOf('({"retcode'), j = t.lastIndexOf('})');
        if (i < 0 || j < 0) throw new Error('visitor parse fail');
        const resp = JSON.parse(t.slice(i + 1, j + 1));
        if (resp.retcode !== 20000000 || !resp.data || !resp.data.sub) throw new Error('visitor gen fail');
        vCache = { at: Date.now(), sub: resp.data.sub, subp: resp.data.subp };
        return vCache;
    }

    function showOnce(wid, v) {
        const headers = {
            'Referer': 'https://m.weibo.cn/detail/' + wid,
            'X-Requested-With': 'XMLHttpRequest',
        };
        if (v) headers['Cookie'] = 'SUB=' + v.sub + '; SUBP=' + v.subp;
        return wxhr({
            url: 'https://m.weibo.cn/statuses/show?id=' + encodeURIComponent(wid),
            headers: headers,
        });
    }

    function parseShow(r) {
        const t = r.responseText || '';
        if (r.status !== 200 || t.charAt(0) !== '{') return null; // HTML/重定向 → 缺身份
        let j;
        try { j = JSON.parse(t); } catch (e) { return null; }
        if (j.ok === 1 && j.data) return { ok: true, exists: true, data: j.data };
        if (j.ok === 0 && String(j.errno) === '20101') return { ok: true, exists: false };
        return { ok: false, error: ('unexpected: ' + (j.errno != null ? j.errno : (j.msg || '')).toString()).slice(0, 120) };
    }

    // 检测微博存活并回传完整 status：{ ok, exists, data }（与本地代理返回结构一致）
    async function check(wid) {
        wid = String(wid || '').trim();
        if (!/^\d{6,}$/.test(wid)) return { ok: false, error: 'bad id' };
        try {
            // ① 直接请求（浏览器已登录微博 / 已有访客 cookie 时直通）
            let r = parseShow(await showOnce(wid, null));
            if (r) return r;
            // ② 生成访客身份后带 Cookie 重试
            const v = await visitorIdentity();
            r = parseShow(await showOnce(wid, v));
            if (r) return r;
            return { ok: false, error: 'show failed' };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
        }
    }

    // 仅在「微博数据管理系统」页面注入桥（@match 已放宽到所有站点，这里做特征过滤）
    const isTool = /微博数据管理系统/.test(document.title || '')
        || !!document.getElementById('weibo-tool-root')
        || !!document.querySelector('[data-weibo-tool]');
    if (!isTool) return;

    // 注入页面（Tampermonkey 沙箱内需用 unsafeWindow）
    const target = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    target.__WB_BRIDGE = {
        name: 'userscript',
        version: '1.0.0',
        check: check,
        ping: function () { return { name: 'userscript', version: '1.0.0' }; },
    };

    console.log('[微博整理助手] 检测桥已注入 ✓ 工具将自动使用浏览器直连通道');
})();
