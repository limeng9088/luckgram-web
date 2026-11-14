import {createSignal, JSX, onCleanup, onMount, Show} from 'solid-js';

import Button from '@components/buttonTsx';
import {GrowHeightReveal} from '@helpers/solid/animations';
import loadFonts from '@helpers/dom/loadFonts';
import {Config, LangPackString} from '@layer';
import I18n, {LangPackKey} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {getSignInLanguageOffer} from '@/luckgram/language';

const KEY: LangPackKey = 'Login.ContinueOnLanguage';

type LangPayload = {langCode: string, strings: LangPackString[]};

// * Luckgram (luckgram-specs#173): which language is offered is Luckgram's choice — always the way back
// * from the one in use — and it is made again after every switch (src/luckgram/language.ts). Upstream
// * offers Telegram's suggestion once and never again.
let configPromise: Promise<Config.config>;
let cacheApplied: Promise<unknown>;

async function getLang(): Promise<LangPayload | undefined> {
  const config = await (configPromise ||= rootScope.managers.apiManager.getConfig());
  await (cacheApplied ||= I18n.getCacheLangPackAndApply().catch((): undefined => undefined));
  const langCode = getSignInLanguageOffer(I18n.getLastRequestedLangCode(), config.suggested_lang_code);
  if(!langCode) return undefined;
  return {langCode, strings: await I18n.getStrings(langCode, [KEY])};
}

// Format the key with the suggested-language strings without leaving the
// app's I18n.strings map mutated — back up, swap in, format, restore.
function formatSuggestedText(strings: LangPackString[]) {
  const backup: LangPackString[] = [];
  strings.forEach((string) => {
    const backupString = I18n.strings.get(string.key as LangPackKey);
    if(!backupString) return;
    backup.push(backupString);
    I18n.strings.set(string.key as LangPackKey, string);
  });

  const text = I18n.format(KEY, true);
  backup.forEach((string) => I18n.strings.set(string.key as LangPackKey, string));
  return text;
}

export default function LanguageChangeButton(): JSX.Element {
  const [visible, setVisible] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [content, setContent] = createSignal<string>('');
  let suggestedLangCode: string;

  let disposed = false, offerId = 0;

  // * the offer for the language in use now; made on mount and again whenever a language is applied
  const offer = async() => {
    const id = ++offerId;
    const payload = await getLang().catch((): undefined => undefined);
    if(disposed || id !== offerId) return;
    if(!payload || !payload.strings.length) {
      setVisible(false);
      return;
    }

    suggestedLangCode = payload.langCode;
    const text = formatSuggestedText(payload.strings);
    await loadFonts({text: [text]});
    if(disposed || id !== offerId) return;

    setContent(text);
    setSubmitting(false);
    setVisible(true);
  };

  const onLanguageApply = () => {
    offer();
  };
  rootScope.addEventListener('language_apply', onLanguageApply);
  onCleanup(() => {
    disposed = true;
    rootScope.removeEventListener('language_apply', onLanguageApply);
  });

  onMount(offer);

  const onClick = () => {
    setSubmitting(true);
    // * a language pack that did not come leaves the button to be pressed again
    I18n.getLangPackAndApply(suggestedLangCode).catch((err) => {
      console.error('suggested language error', err);
      setSubmitting(false);
    });
  };

  return (
    <GrowHeightReveal when={visible()}>
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={submitting()}
        onClick={onClick}
      >
        {/* in the suggested language, not the page's: it orders by its own direction */}
        <span dir="auto">{content()}</span>
        <Show when={submitting()}>
          <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
            <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10"/>
          </svg>
        </Show>
      </Button>
    </GrowHeightReveal>
  );
}
