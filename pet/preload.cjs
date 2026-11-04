// 펫 창 페이지에 window.dscPet 을 넣는다. 페이지가 듣기 전에 온 메시지는 모아 두었다가 넘긴다.
const { contextBridge, ipcRenderer } = require('electron')
let listener = null
const queue = []
ipcRenderer.on('dsc', (_event, message) => { if (listener) listener(message); else queue.push(message) })
const send = (message) => ipcRenderer.send('dsc', message)
contextBridge.exposeInMainWorld('dscPet', {
  on(fn) { listener = fn; for (const message of queue.splice(0)) fn(message) },
  send,
  move: (x, y) => send({ type: 'move', x, y }),
  press: (on) => send({ type: 'press', on: !!on }),
  menu: () => send({ type: 'menu' }),
})
