// Small confetti burst when a job is Completed, like Salesforce's Path celebration.
const COLORS = ['#0176d3', '#3ba755', '#fcb95b', '#f88962', '#a094ed', '#ef6e64']

export function celebrate() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const layer = document.createElement('div')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:300;overflow:hidden'
  for (let i = 0; i < 120; i++) {
    const p = document.createElement('span')
    const size = 6 + Math.random() * 6
    p.style.cssText = `position:absolute;top:-20px;left:${Math.random() * 100}vw;width:${size}px;height:${size * 0.5}px;` +
      `background:${COLORS[i % COLORS.length]};border-radius:1px;opacity:.95`
    p.animate(
      [
        { transform: `translate(0,0) rotate(0deg)` },
        { transform: `translate(${(Math.random() - 0.5) * 300}px, ${window.innerHeight + 40}px) rotate(${Math.random() * 1080}deg)` },
      ],
      { duration: 1800 + Math.random() * 1600, delay: Math.random() * 400, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' },
    )
    layer.appendChild(p)
  }
  document.body.appendChild(layer)
  setTimeout(() => layer.remove(), 4200)
}
