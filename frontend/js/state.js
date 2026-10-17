export const $ = s => document.querySelector(s);

export const PAGE_SIZE = 20;

export const state = {
  videos: [],
  folders: [],
  folderTree: [],
  folder: null,
  selectMode: false,
  selected: new Set(),
  uploads: [],
  page: 1
};
