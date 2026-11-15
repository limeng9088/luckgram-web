import type ChatInput from '@components/chat/input';
import AutocompleteHelperController from '@components/chat/autocompleteHelperController';
import AutocompletePeerHelper from '@components/chat/autocompletePeerHelper';
import {AppManagers} from '@lib/managers';
import processPeerFullForCommands from '@components/chat/processPeerFullForCommands';
import hideCommandAutocomplete from '@components/chat/hideCommandAutocomplete';
import apiManagerProxy from '@lib/apiManagerProxy';
import getPeerActiveUsernames from '@appManagers/utils/peers/getPeerActiveUsernames';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

export default class CommandsHelper extends AutocompletePeerHelper {
  /** Luckgram (replies/controller.ts): after the commands were drawn — how many — for its rows to follow them. */
  public luckgramAfterRender: (commands: number) => void;
  /** Luckgram: takes the press on one of its rows; true when it was one. */
  public luckgramPick: (target: HTMLElement) => boolean;

  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    chatInput: ChatInput,
    private managers: AppManagers
  ) {
    super(appendTo,
      controller,
      'commands-helper',
      (target) => {
        const targetElement = target as HTMLElement;
        // * Luckgram (W11): a quick reply listed under the commands is put into the field, not sent as one
        if(this.luckgramPick?.(targetElement)) return;
        const botPeerId = targetElement.dataset.peerId.toPeerId();
        let text = target.querySelector(`.${AutocompletePeerHelper.BASE_CLASS_LIST_ELEMENT}-name`).textContent;
        if(chatInput.chat.peerId.isAnyChat()) {
          const username = getPeerActiveUsernames(apiManagerProxy.getPeer(botPeerId))[0];
          if(username) {
            text += '@' + username;
          }
        }

        const ephemeralReceiverId = chatInput.chat.peerId.isAnyChat() &&
          targetElement.dataset.ephemeral === '1' ?
          botPeerId.toUserId() :
          undefined;
        hideCommandAutocomplete(controller);
        return chatInput.getReadyToSend(() => {
          chatInput.messageInputField.setValueSilently(text);
          chatInput.sendMessage(true, ephemeralReceiverId);
        });
      },
      'Chat.BotCommands'
    );
  }

  public async checkQuery(query: string, peerId: PeerId) {
    const managers = bindManagersToSession(this.managers);
    const [isBot, isGroup] = await Promise.all([
      managers.appUsersManager.isBot(peerId),
      managers.appPeersManager.isAnyGroup(peerId)
    ]);
    if(!isBot && !isGroup) {
      return false;
    }

    const middleware = this.controller.getMiddleware();
    managers.appProfileManager.getProfileByPeerId(peerId).then((full) => {
      if(!middleware()) {
        return;
      }

      const filtered = processPeerFullForCommands(peerId, full, query);
      this.render(filtered, middleware);
      // * Luckgram (W11): the quick replies the same "/…" asks for come after the commands, in this list
      this.luckgramAfterRender?.(filtered.length);
      // console.log('found commands', found, filtered);
    });

    return true;
  }
}
