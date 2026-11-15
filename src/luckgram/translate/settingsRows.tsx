/*
 * Luckgram Web (luckgram-specs#185, W5 需求 14): the two settings of translation, under
 * "Luckgram 功能 → 消息与语言".
 *
 *  - 不翻译的语言: upstream's own list (Settings → Language → Do Not Translate, which the
 *    translation of a whole chat uses too) — one list, two places to change it;
 *  - 翻译成: LuckgramSettings `translate_to`; unset, the interface's language.
 */

import {JSX, createMemo} from 'solid-js';
import Row from '@components/rowTsx';
import {pickLanguage} from '@components/chat/translation';
import getDoNotTranslateLanguages from '@helpers/getDoNotTranslateLanguages';
import I18n from '@lib/langPack';
import {useAppSettings} from '@stores/appSettings';
import LuckgramSettings from '@/luckgram/core/settings';
import {useStringSetting} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {KEY_TRANSLATE_TO, getIncomingTargetLang} from '@/luckgram/translate/logic';
import {getLanguageName} from '@/luckgram/translate';

export default function TranslateSettingsRows(): JSX.Element {
  const [appSettings, setAppSettings] = useAppSettings();
  const doNotTranslate = createMemo(() => getDoNotTranslateLanguages(appSettings.translations.doNotTranslate));
  const translateTo = useStringSetting(KEY_TRANSLATE_TO);
  const target = () => getIncomingTargetLang(translateTo(), I18n.langCodeNormalized());

  const doNotTranslateText = () => {
    const languages = doNotTranslate();
    return languages.length < 3 ?
      languages.map(getLanguageName).join(lgText('、', ', ')) :
      lgText(`${languages.length} 种语言`, `${languages.length} languages`);
  };

  const pickDoNotTranslate = async() => {
    const languages = await pickLanguage(true, doNotTranslate());
    if(languages) setAppSettings('translations', 'doNotTranslate', languages);
  };

  const pickTarget = async() => {
    const language = await pickLanguage(false);
    if(language) LuckgramSettings.set(KEY_TRANSLATE_TO, language);
  };

  return (
    <>
      <Row clickable={pickDoNotTranslate}>
        <Row.Title>{lgText('不翻译的语言', 'Do not translate')}</Row.Title>
        <Row.Subtitle>{doNotTranslateText()}</Row.Subtitle>
      </Row>
      <Row clickable={pickTarget}>
        <Row.Title>{lgText('翻译成', 'Translate to')}</Row.Title>
        <Row.Subtitle>{getLanguageName(target())}</Row.Subtitle>
      </Row>
    </>
  );
}
