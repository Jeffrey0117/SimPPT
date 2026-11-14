// The tools the MCP server offers. Each one is a thin call into lib/deck-api.mjs.
import {
  versionOf, listDecks, findDeck, readDeck, editDeck, outline, readSlides,
  insertSlides, replaceSlide, deleteSlide, moveSlide,
} from '../lib/deck-api.mjs'

const SYNTAX = [
  'Slide markdown: one page after another, separated by a line that is exactly "---".',
  'A separator may carry a layout for the page that follows: "--- layout=top" (title on top, text below),',
  '"--- layout=bullets" (one # title and one list), "--- layout=cols" (one # title, each ## starts a column, up to 3),',
  '"--- layout=big" (# holds one number or word, one line under it), "--- layout=split" (image left, text right).',
  'No layout = centred. Content: # ## ### headings, - lists, 1. lists, **bold** (shown in the deck\'s accent colour),',
  '*italic*, `code`, ![](image url), "note: ..." lines are speaker notes.',
  'Do not write colours (bg= color= accent=) or front matter: new pages take the deck\'s own look.',
  'Keep each page short — a slide, not a document.',
].join(' ')

const DECK_ARG = {
  type: 'string',
  description: 'Which deck: a file name, with or without extension, or a part of the name that fits only one deck. See list_decks.',
}
const VERSION_ARG = {
  type: 'string',
  description: 'The "version" that get_outline, read_slides or your last write returned. Pass it so that a deck someone changed since then is refused instead of edited at the wrong page.',
}
const page = (description) => ({ type: 'integer', minimum: 1, description })

export const TOOLS = [
  {
    name: 'list_decks',
    description: 'List the SimPPT decks on this machine (the decks/ folder), newest first.',
    inputSchema: { type: 'object', properties: {} },
    run: (root) => ({ decks: listDecks(root).map((deck) => ({ name: deck.name, path: deck.path, modified: new Date(deck.mtime).toISOString() })) }),
  },
  {
    name: 'get_outline',
    description: 'One line per page of a deck: page number, title, layout. Call this first to find where to work; it is much smaller than the deck.',
    inputSchema: { type: 'object', properties: { deck: DECK_ARG }, required: ['deck'] },
    run: (root, { deck }) => {
      const rel = findDeck(root, deck)
      return { deck: rel, ...outline(readDeck(root, rel)) }
    },
  },
  {
    name: 'read_slides',
    description: 'The markdown of one page, or of pages from..to. Read the pages around where you will insert, to match their tone and density.',
    inputSchema: {
      type: 'object',
      properties: { deck: DECK_ARG, from: page('First page to read'), to: page('Last page to read (default: same as from)') },
      required: ['deck', 'from'],
    },
    run: (root, { deck, from, to }) => {
      const rel = findDeck(root, deck)
      const text = readDeck(root, rel)
      return { deck: rel, version: versionOf(text), slides: readSlides(text, from, to === undefined ? from : to) }
    },
  },
  {
    name: 'insert_slides',
    description: `Insert one or more new pages into a deck after a given page. Other pages are not changed. ${SYNTAX}`,
    inputSchema: {
      type: 'object',
      properties: {
        deck: DECK_ARG,
        after: { type: 'integer', minimum: 0, description: 'Insert after this page number. 0 = at the very front.' },
        markdown: { type: 'string', description: 'The new page(s), separated by "---" lines.' },
        version: VERSION_ARG,
      },
      required: ['deck', 'after', 'markdown'],
    },
    run: (root, { deck, after, markdown, version }) => editDeck(root, findDeck(root, deck), (text) => insertSlides(text, after, markdown), { version }),
  },
  {
    name: 'replace_slide',
    description: `Replace the content of one page. The page keeps its settings unless the markdown starts with its own "--- ..." line. ${SYNTAX}`,
    inputSchema: {
      type: 'object',
      properties: { deck: DECK_ARG, page: page('The page to replace'), markdown: { type: 'string', description: 'The new content of the page.' }, version: VERSION_ARG },
      required: ['deck', 'page', 'markdown'],
    },
    run: (root, { deck, page: n, markdown, version }) => editDeck(root, findDeck(root, deck), (text) => replaceSlide(text, n, markdown), { version }),
  },
  {
    name: 'delete_slide',
    description: 'Delete one page. The pages after it keep their look. Page numbers after it shift down by one.',
    inputSchema: { type: 'object', properties: { deck: DECK_ARG, page: page('The page to delete'), version: VERSION_ARG }, required: ['deck', 'page'] },
    run: (root, { deck, page: n, version }) => editDeck(root, findDeck(root, deck), (text) => deleteSlide(text, n), { version }),
  },
  {
    name: 'move_slide',
    description: 'Move one page to another position; the pages in between shift to make room.',
    inputSchema: {
      type: 'object',
      properties: { deck: DECK_ARG, from: page('The page to move'), to: page('The position it should end up at'), version: VERSION_ARG },
      required: ['deck', 'from', 'to'],
    },
    run: (root, { deck, from, to, version }) => editDeck(root, findDeck(root, deck), (text) => moveSlide(text, from, to), { version }),
  },
]

export const callTool = (root, name, args) => {
  const tool = TOOLS.find((entry) => entry.name === name)
  if (!tool) throw Object.assign(new Error(`unknown tool: ${name}`), { code: 'ENOTOOL' })
  return tool.run(root, args && typeof args === 'object' ? args : {})
}
