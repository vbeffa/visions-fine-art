(() => {
"use strict";
const BASE=window.VISIONS_FULL_DATA;
const PUBLISHED_KEY="visions-proposal-c-published-v2";
const $=(s,r=document)=>r.querySelector(s);
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
let data=BASE;
try{const s=localStorage.getItem(PUBLISHED_KEY);if(s)data=JSON.parse(s)}catch{}
const body=document.body, type=body.dataset.pageType, staticId=body.dataset.id||"", root=$("#liveRoot");
const params=new URLSearchParams(location.search);
const id=staticId||params.get("id")||"";
const artist=id=>data.artists.find(a=>a.id===id);
const artwork=id=>data.artworks.find(w=>w.id===id);
const worksFor=id=>data.artworks.filter(w=>w.artistId===id && w.status!=="hidden");
const genericArtwork=w=>`artwork.html?id=${encodeURIComponent(w.id)}`;
const genericArtist=a=>`artist.html?id=${encodeURIComponent(a.id)}`;
const hrefArtist=a=>a.path||genericArtist(a);
const hrefArtwork=w=>w.path||genericArtwork(w);
const image=x=>x||"../assets/placeholder.svg";
function header(){
  const s=data.siteInfo;
  return `<div class="site-header"><div class="header-inner"><a class="brand" href="index.html">${s.logo?`<img src="${esc(s.logo.replace(/^assets\//,"../assets/"))}" alt="${esc(s.galleryName)}">`:`<span class="brand-text">${esc(s.galleryName)}</span>`}</a>
  <nav class="main-nav"><a href="artists/">Artists</a><a href="guarantee.html">Our Guarantee</a><a href="contact.html">Contact</a></nav></div></div>`;
}
function footer(){
  const s=data.siteInfo;return `<footer class="site-footer"><div class="footer-inner"><p>${esc(s.galleryName)}<br>${esc(s.address)} · ${esc(s.cityStateZip)}</p><p>${esc(s.phone)} · ${esc(s.email)}<br>${esc(s.hours)}</p></div></footer>`;
}
function localImage(path){if(!path)return "../assets/placeholder.svg";return path.startsWith("data:")?path:"../"+path}
function renderHome(){
  const featured=data.artists.filter(a=>a.active).slice(0,12);
  root.innerHTML=`${header()}<section class="hero"><div class="wrap"><div class="eyebrow">Sedona · Arizona · Fine Art Gallery</div><h1>Fine art in the heart of Sedona.</h1><p>Explore the artists and artwork represented by Visions Fine Art Gallery.</p></div></section>
  <main class="wrap"><div class="section-head"><div><div class="eyebrow">Artists</div><h2>Explore the collection</h2></div><a href="artists/">View all ${data.artists.filter(a=>a.active).length} artists →</a></div>
  <div class="artist-grid">${featured.map(a=>artistCard(a)).join("")}</div></main>${footer()}`;
}
function artistCard(a){
  return `<a class="artist-card" href="${esc(hrefArtist(a))}"><img src="${esc(localImage(a.image))}" alt=""><div><h3>${esc(a.name)}</h3><span>${worksFor(a.id).length} artworks</span></div></a>`;
}
function renderArtists(){
  const active=data.artists.filter(a=>a.active);
  root.innerHTML=`${header()}<main class="wrap"><div class="eyebrow">Artists</div><h2>Artists represented by Visions</h2><div class="search-row"><input id="artistSearch" placeholder="Search artists…"></div><div class="artist-grid" id="artistGrid">${active.map(a=>artistCard(a)).join("")}</div></main>${footer()}`;
  $("#artistSearch")?.addEventListener("input",e=>{const q=e.target.value.toLowerCase();$("#artistGrid").innerHTML=active.filter(a=>a.name.toLowerCase().includes(q)).map(a=>artistCard(a)).join("")});
}
function renderArtist(){
  const a=artist(id);if(!a){renderMissing("Artist not found");return}
  const works=worksFor(a.id);
  root.innerHTML=`${header()}<main class="wrap"><div class="artist-hero"><img src="${esc(localImage(a.image))}" alt=""><div class="artist-copy"><div class="eyebrow">Artist</div><h1>${esc(a.name)}</h1><p>${esc(a.bio||a.notes||"")}</p></div></div>
  <div class="section-head" style="margin-top:40px"><div><h2>Artwork</h2><p>${works.length} works currently shown in this preview.</p></div></div>
  <div class="art-grid">${works.map(w=>`<a class="art-card" href="${esc(hrefArtwork(w))}"><img src="${esc(localImage(w.thumbnail||w.image))}" alt=""><h3>${esc(w.title)}</h3><span>${w.status==="sold"?"Sold":esc(w.medium||"View artwork")}</span></a>`).join("")}</div></main>${footer()}`;
}
function renderArtwork(){
  const w=artwork(id);if(!w){renderMissing("Artwork not found");return}const a=artist(w.artistId);
  if(w.status==="hidden"){renderMissing("This artwork is hidden from the public site.");return}
  root.innerHTML=`${header()}<main class="wrap"><div class="art-detail"><img class="art-main" src="${esc(localImage(w.image))}" alt=""><div class="art-copy"><div class="eyebrow">${esc(a?.name||"Artist")}</div><h1>${esc(w.title)}</h1><div class="byline">by <a href="${esc(a?hrefArtist(a):"artists/")}">${esc(a?.name||"")}</a></div>
  <span class="status ${w.status==="sold"?"sold":""}">${w.status==="sold"?"Sold":"Available"}</span><div class="meta">${w.medium?`<div class="meta-row"><strong>Medium</strong>${esc(w.medium)}</div>`:""}${w.edition?`<div class="meta-row"><strong>Edition</strong>${esc(w.edition)}</div>`:""}${w.dimensions?`<div class="meta-row"><strong>Dimensions</strong>${esc(w.dimensions)}</div>`:""}</div>${w.description?`<p>${esc(w.description)}</p>`:""}<p>For current availability, please contact the gallery.</p></div></div></main>${footer()}`;
}
function renderPage(){
  const p=data.pages.find(x=>x.id===id);if(!p){renderMissing("Page not found");return}
  root.innerHTML=`${header()}<main class="wrap"><article class="info-page"><div class="eyebrow">Gallery information</div><h1>${esc(p.title)}</h1><p>${esc(p.body||"")}</p></article></main>${footer()}`;
}
function renderMissing(msg){root.innerHTML=`${header()}<main class="wrap"><div class="not-found"><h2>${esc(msg)}</h2><p><a href="index.html">Return to the gallery homepage</a></p></div></main>${footer()}`}
if(type==="home")renderHome();else if(type==="artists")renderArtists();else if(type==="artist")renderArtist();else if(type==="artwork")renderArtwork();else if(type==="page")renderPage();else renderHome();
})();