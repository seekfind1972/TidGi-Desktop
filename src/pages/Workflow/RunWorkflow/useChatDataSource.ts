import { WikiChannel } from '@/constants/channels';
import { usePromiseValue } from '@/helpers/useServiceValue';
import { chatTiddlerTagName } from '@services/wiki/plugin/nofloWorkflow/constants';
import { IWorkspaceWithMetadata } from '@services/workspaces/interface';
import { useEffect, useState } from 'react';
import type { ITiddlerFields } from 'tiddlywiki';
import { SingleChatState } from '../libs/ui/debugUIEffects/store';
import { useChatsStore } from './useChatsStore';
import { IWorkerWikiOperations } from '@services/wiki/wikiOperations/executor/wikiOperationInServer';

export interface IChatTiddler extends ITiddlerFields {
  description: string;
  ['page-cover']: string;
  type: 'application/json';
  /**
   * Which workflow creates this chat.
   */
  workflowID: string;
}

export interface IChatListItem {
  /**
   * Parsed JSON from chatJSONString, parsed when loaded to store. Not exist in the wiki.
   */
  chatJSON?: SingleChatState;
  /**
   * Serialized JSON of the SingleChatState.
   * We store the chat as a JSON tiddler in the wiki, and render the content i18nly from the JSON data.
   */
  chatJSONString?: string;
  description?: string;
  /**
   * Random generated ID
   */
  id: string;
  image?: string;
  metadata?: {
    tiddler: IChatTiddler;
    workspace: IWorkspaceWithMetadata;
  };
  running?: boolean;
  tags: string[];
  /**
   * From caption field, or use ID
   */
  title: string;
  workflowID: string;
  workspaceID: string;
}

/**
 * Get chats from the wiki, based on workflow ID.
 * @param workspacesList Workspaces that the user has access to, as data source.
 * @param workflowID The workflow ID that these chats were generated with.
 */
export function useChatsFromWiki(workspacesList: IWorkspaceWithMetadata[] | undefined, workflowID: string | undefined) {
  const chatItems = usePromiseValue<IChatListItem[]>(
    async () => {
      if (workflowID === undefined) return [];
      const tasks = workspacesList?.map(async (workspace) => {
        try {
          const chatTiddlers = await window.service.wiki.wikiOperationInServer(
            WikiChannel.getTiddlersAsJson,
            workspace.id,
            [`[all[tiddlers]tag[${chatTiddlerTagName}]field:workflowID[${workflowID}]]`],
          );
          return (chatTiddlers ?? []) as IChatTiddler[];
        } catch {
          return [];
        }
      });

      const chatsByWorkspace = await Promise.all(tasks ?? []);
      return workspacesList?.map?.((workspace, workspaceIndex) => {
        const chatTiddlersInWorkspace = chatsByWorkspace[workspaceIndex];
        return chatTiddlersInWorkspace.map((tiddler) => {
          const chatItem: IChatListItem = {
            id: tiddler.title,
            title: (tiddler.caption as string | undefined) ?? tiddler.title,
            chatJSONString: tiddler.text,
            chatJSON: JSON.parse(tiddler.text) as SingleChatState,
            description: tiddler.description,
            tags: tiddler.tags.filter(item => item !== chatTiddlerTagName),
            workspaceID: workspace.id,
            image: tiddler['page-cover'],
            workflowID: tiddler.workflowID,
            metadata: {
              workspace,
              tiddler,
            },
          };
          return chatItem;
        });
      })?.flat?.() ?? [];
    },
    [],
    [workspacesList, workflowID],
  )!;
  return chatItems;
}

export async function addChatToWiki(newItem: IChatListItem) {
  await window.service.wiki.wikiOperationInServer(
    WikiChannel.addTiddler,
    newItem.workspaceID,
    [
      newItem.id,
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
      newItem.chatJSONString || '{}',
      JSON.stringify({
        caption: newItem.title,
        type: 'application/json',
        tags: [...newItem.tags, chatTiddlerTagName],
        description: newItem.description ?? '',
        'page-cover': newItem.image ?? '',
        workflowID: newItem.workflowID,
      }),
      JSON.stringify({ withDate: true }),
    ] as Parameters<IWorkerWikiOperations[WikiChannel.addTiddler]>,
  );
}

export async function deleteChatFromWiki(workspaceID: string, chatID: string) {
  await window.service.wiki.wikiOperationInServer(
    WikiChannel.deleteTiddler,
    workspaceID,
    [chatID],
  );
}

export function sortChat(a: IChatListItem, b: IChatListItem) {
  // @ts-expect-error The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.ts(2362)
  return b.metadata.tiddler.created - a.metadata.tiddler.created;
}

/**
 * Get chats related methods based on workflow ID.
 * @param workspacesList Workspaces that the user has access to, as data source.
 * @param workflowID The workflow ID that these chats were generated with.
 */
export function useLoadInitialChats(workspacesList: IWorkspaceWithMetadata[] | undefined, workflowID: string | undefined) {
  const initialChats = useChatsFromWiki(workspacesList, workflowID);
  const {
    updateChats,
  } = useChatsStore((state) => ({
    updateChats: state.updateChats,
  }));

  useEffect(() => {
    const chatsDict = initialChats.reduce<Record<string, IChatListItem>>((accumulator, chat) => {
      accumulator[chat.id] = chat;
      return accumulator;
    }, {});
    updateChats(chatsDict);
  }, [initialChats, updateChats]);
}

// connect store and dataSource

export function useWorkspaceIDToStoreNewChats(workspacesList: IWorkspaceWithMetadata[] | undefined) {
  const [workspaceIDToStoreNewChats, setWorkspaceIDToStoreNewChats] = useState<string | undefined>();
  // set workspaceIDToStoreNewChats on initial load && workspacesList has value, make it default to save to first workspace.
  useEffect(() => {
    if (workspaceIDToStoreNewChats === undefined && workspacesList?.[0] !== undefined) {
      const workspaceID = workspacesList[0].id;
      setWorkspaceIDToStoreNewChats(workspaceID);
    }
  }, [workspaceIDToStoreNewChats, workspacesList]);
  return workspaceIDToStoreNewChats;
}