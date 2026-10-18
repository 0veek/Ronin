import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { AssistantCitation } from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  DecoratorNode,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { createContext, use, type ReactElement } from "react";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";

import { AssistantCitationChip } from "./chat/AssistantCitationChip";

type SerializedComposerCitationNode = Spread<
  {
    citation: AssistantCitation;
    source: string;
    type: "composer-citation";
    version: 1;
  },
  SerializedLexicalNode
>;

export type ComposerCitationCommentRequest = {
  previousValue: string;
  value: string;
  citationStart: number;
  sourceAnchor: AssistantCitationSourceAnchor;
  insertedSpaces: { before: boolean; after: boolean };
};

export type ComposerCitationCommentTarget = {
  nodeKey: NodeKey;
  sourceAnchor?: AssistantCitationSourceAnchor;
  removeOnCancel?: ComposerCitationCommentRequest["insertedSpaces"];
};

export const ComposerCitationCommentContext = createContext<{
  openComment: ComposerCitationCommentTarget | null;
  onOpenChange: (nodeKey: NodeKey, open: boolean) => void;
}>({ openComment: null, onOpenChange: () => {} });

/** Consume a cite action once its controlled prompt has been committed to the editor. */
export function $consumeComposerCitationCommentRequest(requestRef: {
  current: ComposerCitationCommentRequest | null;
}): ComposerCitationCommentTarget | null {
  const request = requestRef.current;
  if (!request) return null;
  const root = $getRoot();
  const value = root.getTextContent();
  if (value === request.previousValue) return null;
  requestRef.current = null;
  if (value !== request.value) return null;

  // Controlled prompts use one paragraph with inline nodes and explicit line breaks.
  const paragraph = root.getFirstChild();
  if (!$isElementNode(paragraph)) return null;
  let offset = 0;
  for (const node of paragraph.getChildren()) {
    if (offset === request.citationStart && node instanceof ComposerCitationNode) {
      return {
        nodeKey: node.getKey(),
        sourceAnchor: request.sourceAnchor,
        removeOnCancel: request.insertedSpaces,
      };
    }
    offset += node.getTextContentSize();
  }
  return null;
}

/** Undo only the spaces owned by this fresh insertion, preserving existing whitespace. */
export function $removeFreshComposerCitation(
  nodeKey: NodeKey,
  spaces: ComposerCitationCommentRequest["insertedSpaces"],
) {
  const node = $getNodeByKey(nodeKey);
  if (!(node instanceof ComposerCitationNode)) return;
  const before = node.getPreviousSibling();
  const after = node.getNextSibling();
  if (spaces.before && $isTextNode(before) && before.getTextContent().endsWith(" ")) {
    before.spliceText(before.getTextContentSize() - 1, 1, "");
  }
  if (spaces.after && $isTextNode(after) && after.getTextContent().startsWith(" ")) {
    after.spliceText(0, 1, "");
  }
  node.selectPrevious();
  node.remove();
}

function ComposerCitationDecorator(props: { citation: AssistantCitation; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const commentContext = use(ComposerCitationCommentContext);
  const commentTarget =
    commentContext.openComment?.nodeKey === props.nodeKey ? commentContext.openComment : null;
  const onSaveComment = (comment: string): boolean => {
    if (!editor.isEditable()) return false;
    let accepted = false;
    editor.update(
      () => {
        const node = $getNodeByKey(props.nodeKey);
        if (node instanceof ComposerCitationNode && node.isAttached()) {
          node.setComment(comment);
          accepted = true;
        }
      },
      { discrete: true, tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] },
    );
    return accepted;
  };
  const onRestoreFocus = () => {
    if (!editor.isEditable()) return;
    editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (node instanceof ComposerCitationNode && node.isAttached()) node.selectNext();
    });
    editor.getRootElement()?.focus({ preventScroll: true });
  };
  /** Cancelling a comment on a just-created citation removes the chip the cite action added. */
  const onRemove = () => {
    const spaces = commentTarget?.removeOnCancel;
    if (!editor.isEditable() || !spaces) return;
    editor.update(
      () => {
        $removeFreshComposerCitation(props.nodeKey, spaces);
      },
      { tag: HISTORY_PUSH_TAG },
    );
    editor.getRootElement()?.focus({ preventScroll: true });
  };
  return (
    <span
      className="inline-flex min-w-0 max-w-full"
      contentEditable={false}
      spellCheck={false}
      data-composer-citation-chip="true"
    >
      <AssistantCitationChip
        citation={props.citation}
        composer
        commentEditor={{
          open: commentTarget !== null,
          sourceAnchor: commentTarget?.sourceAnchor,
          onOpenChange: (open) => {
            if (open && !editor.isEditable()) return;
            commentContext.onOpenChange(props.nodeKey, open);
          },
          ...(commentTarget?.removeOnCancel ? { onCancel: onRemove } : {}),
          onSave: onSaveComment,
          onRestoreFocus,
        }}
      />
    </span>
  );
}

export class ComposerCitationNode extends DecoratorNode<ReactElement> {
  __citation: AssistantCitation;
  __source: string;

  static override getType(): string {
    return "composer-citation";
  }

  static override clone(node: ComposerCitationNode): ComposerCitationNode {
    return new ComposerCitationNode(node.__citation, node.__source, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerCitationNode): ComposerCitationNode {
    return $createComposerCitationNode(
      serializedNode.citation,
      serializedNode.source,
    ).updateFromJSON(serializedNode);
  }

  constructor(citation: AssistantCitation, source: string, key?: NodeKey) {
    super(key);
    this.__citation = citation;
    this.__source = source;
  }

  override exportJSON(): SerializedComposerCitationNode {
    const node = this.getLatest();
    return {
      ...super.exportJSON(),
      citation: node.__citation,
      source: node.__source,
      type: "composer-citation",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className =
      "composer-inline-chip relative inline-flex max-w-full align-[-0.125em] leading-none";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return this.getLatest().__source;
  }

  setComment(comment: string): this {
    const latest = this.getLatest();
    const citation = withAssistantCitationComment(latest.__citation, comment);
    if (citation.comment === latest.__citation.comment) return latest;
    const source = serializeAssistantCitation(citation);
    const writable = this.getWritable();
    writable.__citation = citation;
    writable.__source = source;
    return writable;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): ReactElement {
    return <ComposerCitationDecorator citation={this.__citation} nodeKey={this.__key} />;
  }
}

export function $createComposerCitationNode(
  citation: AssistantCitation,
  source: string,
): ComposerCitationNode {
  return $applyNodeReplacement(new ComposerCitationNode(citation, source));
}
