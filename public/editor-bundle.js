// Pre-bundle tiptap dependencies
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';

// Make available globally for the inline editor script
window.TiptapEditor = { Editor, StarterKit, Highlight, Color, TextStyle };
