// Luckgram Web (luckgram-specs#137, W1): the name in the interface, the update check, the build's
// credentials and the Content-Security-Policy of the deployed site.

import {luckgramBrandString, luckgramBrandText} from '@/luckgram/brandStrings';
import {getLuckgramVersionText} from '@/luckgram/config';
import {followBrowserLanguage} from '@/luckgram/language';
import {isNewerDeployment} from '@/luckgram/update';
import {resolveLuckgramCredentials, luckgramHtmlContext} from '../../scripts/luckgram/vite-plugin.mjs';
import {buildContentSecurityPolicy, buildHeadersFile} from '../../scripts/luckgram/headers.mjs';

describe('luckgram: the product name', () => {
  test('Telegram Web and WebK become Luckgram', () => {
    expect(luckgramBrandText('This link is not supported on Telegram Web.')).toBe('This link is not supported on Luckgram.');
    expect(luckgramBrandText('Telegram WebK 2.3 (687)')).toBe('Luckgram 2.3 (687)');
    expect(luckgramBrandText('Telegram Web K was updated')).toBe('Luckgram was updated');
    expect(luckgramBrandText('WebK has updated...')).toBe('Luckgram has updated...');
    expect(luckgramBrandText('Telegram 网页版暂不支持此消息')).toBe('Luckgram 网页版暂不支持此消息');
  });

  test('Telegram itself stays: the service, the account, other words with Web', () => {
    for(const text of [
      'Sign in to Telegram',
      'Scan with Telegram app on your phone',
      'Telegram Premium',
      'Open in Web Browser',
      'WebP stickers',
      'Active Web Sessions',
      ''
    ]) {
      expect(luckgramBrandText(text)).toBe(text);
    }
  });

  test('plain and pluralized language pack strings', () => {
    const plain = {_: 'langPackString', key: 'a', value: 'Not supported on Telegram Web'};
    expect(luckgramBrandString(plain)).toBe(plain);
    expect(plain.value).toBe('Not supported on Luckgram');

    const plural = {_: 'langPackStringPluralized', key: 'b', one_value: '%d Telegram Web tab', other_value: '%d Telegram Web tabs'};
    luckgramBrandString(plural);
    expect(plural.one_value).toBe('%d Luckgram tab');
    expect(plural.other_value).toBe('%d Luckgram tabs');
  });

  test('the version line', () => {
    expect(getLuckgramVersionText('2.3')).toMatch(/^Luckgram 2\.3 \(\d+\)/);
    expect(getLuckgramVersionText('2.3')).not.toMatch(/Telegram|WebK/);
  });

  test('the page template', () => {
    expect(luckgramHtmlContext({LUCKGRAM_CHANNEL: 'prod'})).toMatchObject({title: 'Luckgram', origin: 'https://web.luckgram.cc/'});
    expect(luckgramHtmlContext({LUCKGRAM_CHANNEL: 'dev'}).origin).toBe('https://web-dev.luckgram.cc/');
    expect(() => luckgramHtmlContext({LUCKGRAM_CHANNEL: 'staging'})).toThrow(/LUCKGRAM_CHANNEL/);
  });
});

describe('luckgram: the update check', () => {
  const own = 'a'.repeat(40);

  test('another commit is a new version', () => {
    expect(isNewerDeployment({commit: 'b'.repeat(40)}, own)).toBe(true);
  });

  test('the same commit, a broken file or a build without a commit is not', () => {
    expect(isNewerDeployment({commit: own}, own)).toBe(false);
    expect(isNewerDeployment(undefined, own)).toBe(false);
    expect(isNewerDeployment({commit: ''}, own)).toBe(false);
    expect(isNewerDeployment({} as any, own)).toBe(false);
    expect(isNewerDeployment({commit: 'b'.repeat(40)}, '')).toBe(false);
  });
});

describe('luckgram: the browser language', () => {
  const setLanguages = (languages: string[]) => {
    Object.defineProperty(navigator, 'languages', {value: languages, configurable: true});
    Object.defineProperty(navigator, 'language', {value: languages[0], configurable: true});
  };

  // * the part of I18n the switch uses: `raced` is the sign-in page applying the stored pack meanwhile
  const makeI18n = (options: {fail?: boolean, raced?: boolean} = {}) => {
    let current = 'en', stored = 'en';
    const i18n = {
      getLangPackAndApply: vi.fn(async(langCode: string) => {
        if(options.fail) throw new Error('offline');
        stored = langCode;
        if(!options.raced) current = langCode;
      }),
      getCacheLangPackAndApply: vi.fn(async() => {
        current = stored;
      }),
      getLastRequestedLangCode: () => current
    };
    return i18n;
  };

  beforeEach(() => localStorage.clear());

  test('a Chinese browser on the bundled English pack is switched to Chinese, once', async() => {
    setLanguages(['zh-CN', 'en']);
    const i18n = makeI18n();
    await followBrowserLanguage({lang_code: 'en'}, i18n);
    expect(i18n.getLangPackAndApply).toHaveBeenCalledWith('zh-hans-raw');
    expect(i18n.getLastRequestedLangCode()).toBe('zh-hans-raw');
    expect(i18n.getCacheLangPackAndApply).not.toHaveBeenCalled();

    // * the user went back to English in Settings: it stays
    expect(followBrowserLanguage({lang_code: 'en'}, i18n)).toBeUndefined();
    expect(i18n.getLangPackAndApply).toHaveBeenCalledTimes(1);
  });

  test('the pack is shown even when the sign-in page applied the stored one meanwhile', async() => {
    setLanguages(['zh-CN']);
    const i18n = makeI18n({raced: true});
    await followBrowserLanguage({lang_code: 'en'}, i18n);
    expect(i18n.getCacheLangPackAndApply).toHaveBeenCalledTimes(1);
    expect(i18n.getLastRequestedLangCode()).toBe('zh-hans-raw');
    expect(localStorage.getItem('lg_lang_followed')).toBe('1');
  });

  test('a failed switch is tried again at the next start', async() => {
    setLanguages(['zh-TW']);
    const i18n = makeI18n({fail: true});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await followBrowserLanguage({lang_code: 'en'}, i18n);
    await followBrowserLanguage({lang_code: 'en'}, i18n);
    expect(i18n.getLangPackAndApply).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test('any other browser stays in English, and a chosen language is kept', () => {
    const i18n = makeI18n();
    setLanguages(['en-US', 'zh-CN']);
    expect(followBrowserLanguage({lang_code: 'en'}, i18n)).toBeUndefined();

    localStorage.clear();
    setLanguages(['zh-CN']);
    expect(followBrowserLanguage({lang_code: 'ru'}, i18n)).toBeUndefined();
    expect(i18n.getLangPackAndApply).not.toHaveBeenCalled();
  });
});

describe('luckgram: the credentials of a build', () => {
  const upstream = {id: '1025907', hash: 'f'.repeat(32)};
  const hash = '0123456789abcdef0123456789abcdef';

  test('taken from TG_API_ID / TG_API_HASH', () => {
    expect(resolveLuckgramCredentials({TG_API_ID: ' 123456 ', TG_API_HASH: hash}, upstream)).toEqual({id: '123456', hash});
  });

  test('a build without them fails, it does not fall back to upstream\'s', () => {
    expect(() => resolveLuckgramCredentials({}, upstream)).toThrow(/not set/);
    expect(() => resolveLuckgramCredentials({TG_API_ID: '123456'}, upstream)).toThrow(/not set/);
    expect(() => resolveLuckgramCredentials({TG_API_ID: 'abc', TG_API_HASH: hash}, upstream)).toThrow(/not a number/);
    expect(() => resolveLuckgramCredentials({TG_API_ID: '123456', TG_API_HASH: 'short'}, upstream)).toThrow(/32 hex/);
  });

  test('upstream\'s own pair is refused', () => {
    expect(() => resolveLuckgramCredentials({TG_API_ID: upstream.id, TG_API_HASH: hash}, upstream)).toThrow(/upstream/);
    expect(() => resolveLuckgramCredentials({TG_API_ID: '123456', TG_API_HASH: upstream.hash.toUpperCase()}, upstream)).toThrow(/upstream/);
  });
});

describe('luckgram: the headers of the deployed site', () => {
  test('requests go to the site itself, Telegram and Luckgram only', () => {
    const csp = buildContentSecurityPolicy();
    const connect = /connect-src ([^;]+)/.exec(csp)[1].split(' ');
    expect(connect).toEqual([
      '\'self\'', 'data:', 'blob:',
      'https://*.telegram.org', 'wss://*.telegram.org',
      'https://*.luckgram.cc', 'wss://*.luckgram.cc',
      // * the backup relay and the API's backup addresses, for when luckgram.cc is blocked
      'wss://lgws.cat158.com', 'https://lg.cat158.com', 'https://lg-dev.cat158.com',
      // * Telegram's built-in payments
      'https://api.stripe.com'
    ]);

    expect(csp).toContain('default-src \'self\'');
    expect(/script-src ([^;]+)/.exec(csp)[1]).not.toMatch(/https?:|\s'unsafe-eval'|unsafe-inline/);
    expect(/img-src ([^;]+)/.exec(csp)[1]).not.toMatch(/https?:/);
  });

  test('only the production address may be indexed', () => {
    expect(buildHeadersFile('dev')).toContain('X-Robots-Tag: noindex');
    expect(buildHeadersFile('local')).toContain('X-Robots-Tag: noindex');
    // * for the site's own address, that is; its pages.dev addresses are another matter (specs#167, below)
    expect(buildHeadersFile('prod').split('\n\n')[0]).not.toContain('X-Robots-Tag');
    expect(buildHeadersFile('prod')).toContain('/luckgram-version\n  Cache-Control: no-store');
  });
});

// ---- luckgram-specs#167: the sign-in page is Luckgram's, and says what Luckgram is
import {luckgramSignInText} from '@/luckgram/brandStrings';
import {getCanonicalRedirect} from '@/luckgram/canonical';

describe('luckgram: the sign-in screens', () => {
  const string = (key: string, value: string, langCode: string) => luckgramBrandString({_: 'langPackString', key, value}, langCode).value;

  test('the titles name Luckgram, in Chinese, in English, and in any other language', () => {
    expect(string('Login.Title', '登录 Telegram', 'zh-hans-raw')).toBe('登录 Luckgram');
    expect(string('Login.Title', 'Sign in to Telegram', 'en')).toBe('Sign in to Luckgram');
    expect(string('Login.QR.Title', '扫码登录 Telegram', 'zh-hant')).toBe('扫码登录 Luckgram');
    expect(string('Login.QR.Title', 'Log in by QR Code', 'en')).toBe('Log in to Luckgram by QR code');
    expect(string('Login.Title', 'Вход в Telegram', 'ru')).toBe('Вход в Luckgram');
    // * the bundled English strings, before any pack has said its language
    expect(string('Login.Title', 'Sign in to Telegram', undefined)).toBe('Sign in to Luckgram');
  });

  test('they say that the account is a Telegram account, and which apps scan the code', () => {
    expect(string('Login.StartText', 'x', 'zh-hans')).toContain('Telegram 账号');
    expect(string('Login.StartText', 'x', 'en')).toContain('your Telegram account');
    expect(string('Login.QR.Subtitle', 'Scan with Telegram app on your phone', 'en')).toBe('Scan with Telegram or Luckgram on your phone');
    expect(string('Login.QR.Help1', '在您的手机上打开Telegram', 'zh-hans')).toBe('在手机上打开 Telegram 或 Luckgram');
    // * in another language the instructions stay as the pack has them
    expect(string('Login.QR.Help1', 'Откройте Telegram на телефоне', 'ru')).toBe('Откройте Telegram на телефоне');
  });

  test('no title of the sign-in screens says "Telegram" alone, nothing else is touched', () => {
    for(const langCode of ['zh-hans', 'en', 'ru', undefined]) {
      for(const key of ['Login.Title', 'Login.QR.Title']) {
        expect(luckgramSignInText(key, langCode, 'Sign in to Telegram')).not.toMatch(/Telegram/);
      }
    }

    expect(luckgramSignInText('Login.Next', 'en', 'Next')).toBeUndefined();
    expect(string('Login.Next', 'Next', 'en')).toBe('Next');
    expect(string('Chat.Title', 'Telegram Web', 'en')).toBe('Luckgram');
  });
});

describe('luckgram: one address for the production site', () => {
  const at = (hostname: string) => ({hostname, pathname: '/', search: '?account=2', hash: '#@durov'});

  test('a production build under a pages.dev address goes to the site, with the same path', () => {
    expect(getCanonicalRedirect('prod', at('luckgram-web.pages.dev'))).toBe('https://web.luckgram.cc/?account=2#@durov');
    expect(getCanonicalRedirect('prod', at('3f2a1b0c.luckgram-web.pages.dev'))).toBe('https://web.luckgram.cc/?account=2#@durov');
  });

  test('the site itself, its backup entrance and development builds stay where they are', () => {
    for(const hostname of ['web.luckgram.cc', 'lgweb.cat158.com', 'localhost', 'pages.dev.evil.example']) {
      expect(getCanonicalRedirect('prod', at(hostname))).toBeUndefined();
    }

    expect(getCanonicalRedirect('dev', at('feat-x.luckgram-web-dev.pages.dev'))).toBeUndefined();
    expect(getCanonicalRedirect('local', at('luckgram-web.pages.dev'))).toBeUndefined();
  });

  test('the headers keep every pages.dev address of the production site out of search engines', () => {
    const prod = buildHeadersFile('prod');
    expect(prod).toContain('https://:project.pages.dev/*\n  X-Robots-Tag: noindex, nofollow');
    expect(prod).toContain('https://:deployment.:project.pages.dev/*\n  X-Robots-Tag: noindex, nofollow');
    // * the site's own address is indexed
    expect(prod.split('\n\n')[0]).not.toContain('X-Robots-Tag');
    expect(buildHeadersFile('dev').split('\n\n')[0]).toContain('X-Robots-Tag: noindex, nofollow');
  });

  test('the description says what the site is', () => {
    const {description} = luckgramHtmlContext({LUCKGRAM_CHANNEL: 'prod'} as any);
    expect(description).toMatch(/third-party client/);
    expect(description).toMatch(/not an official Telegram app/);
  });
});

// ---- luckgram-specs#167: what is sent to a browser does not read as Telegram Web
import {
  LUCKGRAM_TILE_COLOR, brandEmbedMessages, brandTileColor, extractShell, findFingerprints
} from '../../scripts/luckgram/fingerprint.mjs';

describe('luckgram: the HTML that is sent', () => {
  const DESCRIPTION = 'Luckgram is an independent third-party client that uses the Telegram API. It is not an official Telegram app.';
  const built = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <!-- What the page itself may load besides its own files -->',
    '    <title>Luckgram</title>',
    `    <meta name="description" content="${DESCRIPTION}">`,
    '    <meta name="msapplication-TileColor" content="#2d89ef">',
    '    <script type="module" crossorigin src="./fAbCdEfGh.js"></script>',
    '  </head>',
    '  <body class="animation-level-2 has-auth-pages">',
    '    <svg><path id="logo" d="M0 0"/></svg>',
    '    <!-- hidden until the chat UI exists -->',
    '    <div class="whole page-chats" id="page-chats"><div class="tabs-tab sidebar-left" id="column-left">it\'s "here"</div></div>',
    '  </body>',
    '</html>'
  ].join('\n');

  test('upstream\'s skeleton leaves index.html for a script that puts it back as it was, before the app\'s script', () => {
    const {html, shellName, shellCode} = extractShell(built);
    expect(html).not.toMatch(/page-chats|sidebar-left|has-auth-pages|<!--/);
    expect(html).toContain('<body>');
    expect(shellName).toMatch(/^f[A-Za-z0-9_-]{8}\.js$/);
    expect(html.indexOf(shellName)).toBeGreaterThan(-1);
    expect(html.indexOf(shellName)).toBeLessThan(html.indexOf('fAbCdEfGh.js'));

    // * run it against a document: the same class, the same elements, in the same order
    document.body.className = '';
    document.body.innerHTML = '';
    new Function(shellCode)();
    expect(document.body.className).toBe('animation-level-2 has-auth-pages');
    expect([...document.body.children].map((element) => element.tagName.toLowerCase())).toEqual(['svg', 'div']);
    expect(document.getElementById('column-left').textContent).toBe('it\'s "here"');
    expect(document.querySelector('svg #logo')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('<!--');
    document.body.innerHTML = '';
    document.body.className = '';

    // * the same page gives the same script: its name is its content's
    expect(extractShell(built).shellName).toBe(shellName);
  });

  test('a page it does not understand stops the build instead of going out half done', () => {
    expect(() => extractShell(built.replace('<svg>', '<script src="x.js"></script><svg>'))).toThrow(/<script> inside <body>/);
    expect(() => extractShell('<html><head></head></html>')).toThrow(/no <body>/);
    expect(() => extractShell(built.replace('    <script type="module" crossorigin src="./fAbCdEfGh.js"></script>\n', ''))).toThrow(/not in <head>/);
  });

  test('the tile colour and the embed frame\'s messages are Luckgram\'s', () => {
    expect(brandTileColor('<TileColor>#2d89ef</TileColor> content="#2D89EF"')).toBe(`<TileColor>${LUCKGRAM_TILE_COLOR}</TileColor> content="${LUCKGRAM_TILE_COLOR}"`);
    expect(brandEmbedMessages('type!==`tweb-embed-html`;post({type:"tweb-embed-ready"})')).toBe('type!==`lg-embed-html`;post({type:"lg-embed-ready"})');
  });

  describe('the check that none of it comes back', () => {
    const clean = () => ({
      html: brandTileColor(extractShell(built).html),
      files: ['index.html', 'fAbCdEfGh.js', 'fQwErTyUi.css', 'fAbCdEfGh.js.map', 'assets/img/logo.svg', 'recorder.min.js'],
      texts: {'site.webmanifest': `{"name":"Luckgram","description": "${DESCRIPTION}"}`, 'browserconfig.xml': `<TileColor>${LUCKGRAM_TILE_COLOR}</TileColor>`},
      channel: 'dev'
    });

    test('a site that went through it has nothing to report', () => {
      expect(findFingerprints(clean())).toEqual([]);
    });

    test('the page as upstream builds it is reported, item by item', () => {
      const found = findFingerprints({...clean(), html: built}).join('\n');
      expect(found).toMatch(/has comments/);
      expect(found).toMatch(/tile colour/);
      expect(found).toMatch(/skeleton \(page-chats\)/);
      expect(found).toMatch(/skeleton \(sidebar-left\)/);
    });

    test('"Telegram" anywhere but in the description; upstream\'s names', () => {
      const site = clean();
      expect(findFingerprints({...site, html: site.html.replace('<title>Luckgram</title>', '<title>Sign in to Telegram</title>')}).join('\n')).toMatch(/says "Telegram" outside the description/);
      expect(findFingerprints({...site, html: site.html.replace('</head>', '<meta name="generator" content="tweb"></head>')}).join('\n')).toMatch(/names upstream/);
      expect(findFingerprints({...site, texts: {'site.webmanifest': '{"name":"Telegram Web"}'}}).length).toBeGreaterThan(0);
      expect(findFingerprints({...site, texts: {'site.webmanifest': '{"name":"Luckgram","short_name":"Telegram"}'}}).join('\n')).toMatch(/outside the description/);
    });

    test('files named for what they are instead of by their hash; source maps in production', () => {
      const site = clean();
      expect(findFingerprints({...site, files: [...site.files, 'telegramMeWebManager-DcZfJQi7.js']}).join('\n')).toMatch(/named after upstream/);
      expect(findFingerprints({...site, files: [...site.files, 'appImManager-B3KLZ58p.js']}).join('\n')).toMatch(/carries upstream's name/);
      expect(findFingerprints({...site, files: [...site.files, 'addToFolderDropdownMenu-CcHAQGJF.css']}).join('\n')).toMatch(/carries upstream's name/);
      expect(findFingerprints({...site, channel: 'prod'}).join('\n')).toMatch(/production site carries a source map/);
      expect(findFingerprints({...site, channel: 'prod', files: site.files.filter((file) => !file.endsWith('.map'))})).toEqual([]);
    });
  });
});
