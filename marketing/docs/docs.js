// Bobby docs: the menu starts folded on narrow screens, and "On this page" marks the section you're reading.
const menu = document.querySelector(".side details");
if (menu && matchMedia("(max-width: 860px)").matches) menu.open = false;

const links = [...document.querySelectorAll(".toc a")];
const heads = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
function mark() {
  const line = innerHeight * 0.25;
  let cur = heads[0];
  for (const h of heads) if (h.getBoundingClientRect().top <= line) cur = h;
  links.forEach((a) => a.classList.toggle("on", a.hash === `#${cur?.id}`));
}
if (heads.length) { addEventListener("scroll", mark, { passive: true }); mark(); }
