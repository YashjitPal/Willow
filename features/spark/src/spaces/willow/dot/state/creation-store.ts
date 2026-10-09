import { sparkPathFor } from '../../../../spark-routes';

/** A bot's conversation: Willow's `/spark/dots/<id>`, which Spaces' router hands back to Spark. */
export const orbitConversationPath = (conversationId: string) => sparkPathFor({ page: 'dots', dotId: conversationId });
