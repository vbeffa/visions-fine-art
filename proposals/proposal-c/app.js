(() => {
"use strict";

const DRAFT_KEY="visions-proposal-c-draft-v3";
const PUBLISHED_KEY="visions-proposal-c-published-v3";
const baseline=window.VISIONS_FULL_DATA;
const clone=o=>JSON.parse(JSON.stringify(o));
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

let state=loadDraft();
let ui={
  section:"dashboard",
  selectedArtistId:state.artists[0]?.id||null,
  selectedArtworkId:state.artworks[0]?.id||null,
  selectedPageId:state.pages[0]?.id||null,
  editingArtistId:null,editingArtworkId:null,editingPageId:null,
  draft:null,previewKind:"home",
  search:"",artistFilter:"all",artworkPage:1,imagePage:1
};
const PAGE_SIZE=50, IMAGE_PAGE_SIZE=48;
const workspace=$("#workspace"),sectionTitle=$("#sectionTitle"),pendingPill=$("#pendingPill"),
      previewFrame=$("#previewFrame"),previewStatus=$("#previewStatus"),toast=$("#toast");

const BAD_PAGE_NAV="Visions Home · · · · · · · · · · Our Guarantee Contact Us/Location Join our Mailing List";
function repairKnownPageArtifacts(snapshot){
  if(!snapshot?.pages||!baseline?.pages)return snapshot;
  const baselineByPath=new Map(baseline.pages.map(p=>[p.path,p]));
  snapshot.pages=snapshot.pages.map(p=>{
    const b=baselineByPath.get(p.path);
    if(!b)return p;
    const body=(p.body||"").trim();
    const bad=
      body===BAD_PAGE_NAV ||
      body.startsWith("'Unknown' by Unknown - Page") ||
      (p.path==="aa_pedestals/"&&!body);
    return bad?{...p,title:b.title,body:b.body}:p;
  });
  return snapshot;
}
function loadDraft(){
  try{
    const s=localStorage.getItem(DRAFT_KEY);
    return s?repairKnownPageArtifacts(JSON.parse(s)):clone(baseline);
  }
  catch{return clone(baseline)}
}
function persist(){
  try{localStorage.setItem(DRAFT_KEY,JSON.stringify(state))}
  catch{showToast("Browser storage is full. Reset the demo or use fewer uploaded images.")}
}
function publishedState(){
  try{
    const s=localStorage.getItem(PUBLISHED_KEY);
    return s?repairKnownPageArtifacts(JSON.parse(s)):null;
  }catch{return null}
}
// Local file:// pages do not reliably share localStorage. When the full live
// preview is opened from this admin tab, it can request the browser-local
// published state through window.postMessage instead.
window.addEventListener("message",event=>{
  if(event.data?.type!=="visions-request-published-state"||!event.source)return;
  const published=publishedState()||clone(baseline);
  try{
    event.source.postMessage(
      {type:"visions-published-state",state:published},
      "*"
    );
  }catch{}
});
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function slug(v=""){return v.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"item"}
function artist(id){return state.artists.find(a=>a.id===id)}
function artwork(id){return state.artworks.find(w=>w.id===id)}
function worksFor(id){return state.artworks.filter(w=>w.artistId===id)}
function showToast(m){toast.textContent=m;toast.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove("show"),2300)}
function recordChange(label){
  state.meta.unpublishedChanges=(state.meta.unpublishedChanges||0)+1;
  state.meta.activity=state.meta.activity||[];
  state.meta.activity.unshift(label);state.meta.activity=state.meta.activity.slice(0,8);
  persist();updatePending();
}
function updatePending(){
  const n=state.meta.unpublishedChanges||0;
  pendingPill.textContent=n?`${n} unpublished change${n===1?"":"s"}`:"No unpublished changes";
  pendingPill.classList.toggle("has-changes",!!n);
  const publish=$("#publishButton");
  if(publish){
    publish.disabled=!n;
    publish.title=n?"Publish saved changes to the browser-local live preview":"There are no unpublished changes";
  }

  const reset=$("#resetDemo");
  if(reset){
    const hasPublishedChanges=!!publishedState();
    reset.disabled=!hasPublishedChanges;
    reset.title=hasPublishedChanges
      ?"Restore the original catalog and clear the published browser-local preview"
      :"There are no published preview changes to reset";
  }
}
function navigate(section){
  ui.section=section;ui.draft=null;ui.editingArtistId=null;ui.editingArtworkId=null;ui.editingPageId=null;
  ui.search="";ui.artistFilter="all";ui.artworkPage=1;ui.imagePage=1;
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.section===section));
  sectionTitle.textContent={dashboard:"Dashboard",homepage:"Homepage",artists:"Artists",artworks:"Artworks",site:"Site Information",pages:"Pages",images:"Image Library"}[section];
  render();
}
function render(){
  if(ui.section==="dashboard")renderDashboard();
  if(ui.section==="homepage")renderHomepage();
  if(ui.section==="artists")renderArtists();
  if(ui.section==="artworks")renderArtworks();
  if(ui.section==="site")renderSite();
  if(ui.section==="pages")renderPages();
  if(ui.section==="images")renderImages();
  renderPreview();updatePending();
}
function publishedMessage(){
  const p=publishedState();
  if(!p?.meta?.publishedAt)return `<div class="muted">The static live preview is currently showing the original catalog.</div>`;
  const dt=new Date(p.meta.publishedAt);
  return `<div class="publish-state"><strong>Published preview exists.</strong><br>Last published locally: ${esc(dt.toLocaleString())}</div>`;
}
function renderDashboard(){
  ui.previewKind="home";
  const pub=publishedState();
  workspace.innerHTML=`
    <div class="metrics">
      <div class="metric"><strong>${state.artists.length}</strong><span>Artists</span></div>
      <div class="metric"><strong>${state.artworks.length}</strong><span>Artwork records</span></div>
      <div class="metric"><strong>${state.meta.unpublishedChanges||0}</strong><span>Unpublished changes</span></div>
    </div>
    <section class="panel">
      <div class="panel-header"><div><h2>Full Visions catalog</h2><p>This prototype is loaded with the complete extracted catalog rather than sample records.</p></div></div>
      <div class="catalog-summary">
        <span class="catalog-chip">${state.artists.filter(a=>a.active).length} visible artists</span>
        <span class="catalog-chip">${state.artworks.filter(w=>w.status==="available").length} available artworks</span>
        <span class="catalog-chip">${state.pages.length} informational pages</span>
      </div>
      <div class="scope-card">
        <strong>Production implementation estimate: $500–$1,500</strong>
        <span>The admin and static-site generation workflow can be demonstrated here. Final production pricing depends on the live hosting environment, backup/rollback requirements, and the deployment mechanism available.</span>
      </div>
      ${publishedMessage()}
    </section>
    <section class="panel">
      <div class="panel-header"><div><h2>How this prototype publishes</h2><p>Draft edits and the published preview are separate browser-local states.</p></div></div>
      <div class="activity-list">
        <div class="activity-row"><strong>1.</strong> Edit an artist, artwork, page or site detail.</div>
        <div class="activity-row"><strong>2.</strong> Save the record. The right-hand editing preview updates immediately.</div>
        <div class="activity-row"><strong>3.</strong> Click <strong>Publish Preview</strong> to copy all saved draft data into the published state.</div>
        <div class="activity-row"><strong>4.</strong> Open the full static site under <strong>/proposal-c/live/</strong> and browse the published changes.</div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><div><h2>Recent activity</h2></div></div>
      <div class="activity-list">${(state.meta.activity||[]).map(x=>`<div class="activity-row">${esc(x)}</div>`).join("")}</div>
    </section>`;
}
function renderHomepage(){
  ui.previewKind="homepage-draft";
  if(!ui.draft||ui.draft.entity!=="homepage"){
    ui.draft={entity:"homepage",...clone(state.homepage||{})};
    ui.draft.featuredArtistIds=[...(ui.draft.featuredArtistIds||[])];
  }
  const d=ui.draft;
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>Homepage content</h2><p>Edit the main text and choose which artists appear in the featured section.</p></div></div>
    <form id="homepageForm">
      <div class="form-grid">
        <div class="field wide"><label>Hero eyebrow</label><input name="eyebrow" value="${esc(d.eyebrow||"")}"></div>
        <div class="field wide"><label>Hero headline</label><input name="headline" value="${esc(d.headline||"")}"></div>
        <div class="field wide"><label>Hero introduction</label><textarea name="intro">${esc(d.intro||"")}</textarea></div>
        <div class="field"><label>Artists eyebrow</label><input name="artistsEyebrow" value="${esc(d.artistsEyebrow||"")}"></div>
        <div class="field"><label>Artists heading</label><input name="artistsHeading" value="${esc(d.artistsHeading||"")}"></div>
        <div class="field wide"><label>Artists introduction</label><textarea name="artistsIntro">${esc(d.artistsIntro||"")}</textarea></div>
        <div class="field wide">
          <label>Featured artists</label>
          <div class="featured-list">
            ${state.artists.map(a=>`<label class="featured-option"><input type="checkbox" class="featured-artist" value="${a.id}" ${(d.featuredArtistIds||[]).includes(a.id)?"checked":""}> ${esc(a.name)}</label>`).join("")}
          </div>
          <small>Select the artists to feature on the homepage. The preview shows up to 12.</small>
        </div>
      </div>
      <div class="form-actions"><button class="btn primary">Save Homepage</button></div>
    </form>
  </section>`;

  bindDraft($("#homepageForm"),["eyebrow","headline","intro","artistsEyebrow","artistsHeading","artistsIntro"]);

  $$(".featured-artist",workspace).forEach(cb=>cb.addEventListener("change",()=>{
    d.featuredArtistIds=$$(".featured-artist",workspace).filter(x=>x.checked).map(x=>x.value);
    previewStatus.textContent="Unsaved preview";
    renderPreview();
  }));

  $("#homepageForm")?.addEventListener("submit",e=>{
    e.preventDefault();
    state.homepage=cleanEntity(d);
    recordChange("Updated homepage content");
    showToast("Homepage saved.");
    ui.draft=null;
    render();
  });
}

function renderArtists(){
  if(ui.editingArtistId!==null||ui.draft?.entity==="artist"){renderArtistEditor();return}
  ui.previewKind="artist";
  const q=ui.search.trim().toLowerCase();
  const list=state.artists.filter(a=>a.name.toLowerCase().includes(q));
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>Artists</h2><p>${list.length} of ${state.artists.length} artists shown.</p></div><button class="btn primary" id="addArtist">+ Add Artist</button></div>
    <div class="toolbar"><div class="search"><input id="artistSearch" placeholder="Search all artists…" value="${esc(ui.search)}"></div></div>
    <div class="entity-grid">${list.map(a=>`<article class="entity-card">
      <img src="${esc(a.image||"assets/placeholder.svg")}" alt="">
      <div><h3>${esc(a.name)}</h3><p>${worksFor(a.id).length} artworks · ${a.active?"Visible":"Hidden"}</p>
      <div class="entity-actions"><button class="btn secondary small edit-artist" data-id="${a.id}">Edit</button><button class="btn secondary small preview-artist" data-id="${a.id}">Preview</button></div></div>
    </article>`).join("")}</div>
  </section>`;
  $("#artistSearch")?.addEventListener("input",e=>{ui.search=e.target.value;renderArtists()});
  $("#addArtist")?.addEventListener("click",()=>{ui.editingArtistId="new";ui.draft={entity:"artist",id:`artist-${Date.now()}`,name:"",bio:"",notes:"",image:"assets/placeholder.svg",active:true,sortOrder:state.artists.length+1,path:"",bioPath:"",sourceUrl:""};render()});
  $$(".edit-artist",workspace).forEach(b=>b.addEventListener("click",()=>{ui.editingArtistId=b.dataset.id;ui.selectedArtistId=b.dataset.id;ui.draft={entity:"artist",...clone(artist(b.dataset.id))};render()}));
  $$(".preview-artist",workspace).forEach(b=>b.addEventListener("click",()=>{ui.selectedArtistId=b.dataset.id;ui.previewKind="artist";renderPreview()}));
}
function renderArtistEditor(){
  const d=ui.draft;ui.previewKind="artist-draft";
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>${ui.editingArtistId==="new"?"Add Artist":"Edit Artist"}</h2><p>Changes appear immediately in the editing preview.</p></div></div>
    <form id="artistForm">
      <div class="image-upload"><img id="artistImagePreview" src="${esc(d.image||"assets/placeholder.svg")}" alt=""><div class="field"><label>Representative image</label><label class="file-button">Choose image<input type="file" id="artistImageFile" accept="image/*"></label><small>Demo uploads are resized and stored in this browser.</small></div></div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field wide"><label>Artist name</label><input name="name" value="${esc(d.name)}"></div>
        <div class="field wide"><label>Biography</label><textarea name="bio" style="min-height:240px">${esc(d.bio||"")}</textarea></div>
        <div class="field wide"><label>Artist notes</label><textarea name="notes">${esc(d.notes||"")}</textarea></div>
        <div class="field wide"><label class="checkbox-row"><input type="checkbox" name="active" ${d.active?"checked":""}> Show artist on website</label></div>
      </div>
      <div class="form-actions"><button type="button" class="btn secondary" id="cancelArtist">Cancel</button><button class="btn primary">Save Changes</button></div>
    </form></section>`;
  bindDraft($("#artistForm"),["name","bio","notes"],"active");
  $("#artistImageFile")?.addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;d.image=await imageData(f);$("#artistImagePreview").src=d.image;renderPreview()});
  $("#cancelArtist")?.addEventListener("click",()=>{ui.draft=null;ui.editingArtistId=null;render()});
  $("#artistForm")?.addEventListener("submit",e=>{e.preventDefault();if(!d.name.trim()){showToast("Artist name is required.");return}
    const isNew=ui.editingArtistId==="new";
    if(isNew){d.path=`artist.html?id=${encodeURIComponent(d.id)}`;state.artists.push(cleanEntity(d))}
    else state.artists[state.artists.findIndex(a=>a.id===d.id)]=cleanEntity(d);
    ui.selectedArtistId=d.id;recordChange(`${isNew?"Added":"Updated"} artist: ${d.name}`);showToast("Artist saved.");ui.draft=null;ui.editingArtistId=null;render();
  });
}
function filteredWorks(){
  const q=ui.search.trim().toLowerCase();
  return state.artworks.filter(w=>{
    const a=artist(w.artistId);
    return (ui.artistFilter==="all"||w.artistId===ui.artistFilter)&&(!q||w.title.toLowerCase().includes(q)||(a?.name||"").toLowerCase().includes(q));
  });
}
function paginationHtml(total,page,size){
  const pages=Math.max(1,Math.ceil(total/size));page=Math.min(page,pages);
  return `<div class="pagination"><span>Showing ${total?((page-1)*size+1):0}–${Math.min(page*size,total)} of ${total}</span><div><button class="page-btn prev-page" ${page<=1?"disabled":""}>Previous</button><span class="catalog-chip">Page ${page} of ${pages}</span><button class="page-btn next-page" ${page>=pages?"disabled":""}>Next</button></div></div>`;
}
function renderArtworks(){
  if(ui.editingArtworkId!==null||ui.draft?.entity==="artwork"){renderArtworkEditor();return}
  ui.previewKind="artwork";
  const all=filteredWorks(),pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));ui.artworkPage=Math.min(ui.artworkPage,pages);
  const start=(ui.artworkPage-1)*PAGE_SIZE,list=all.slice(start,start+PAGE_SIZE);
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>Artworks</h2><p>Search and edit the complete extracted catalog.</p></div><button class="btn primary" id="addArtwork">+ Add Artwork</button></div>
    <div class="toolbar"><div class="search"><input id="artworkSearch" placeholder="Search 875 artworks or artists…" value="${esc(ui.search)}"></div>
      <select id="artistFilter"><option value="all">All artists</option>${state.artists.map(a=>`<option value="${a.id}" ${ui.artistFilter===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div>
    <div class="artwork-list">${list.map(w=>{const a=artist(w.artistId);return `<article class="artwork-row">
      <img src="${esc(w.thumbnail||w.image||"assets/placeholder.svg")}" alt=""><div><h3>${esc(w.title)}</h3><p>${esc(a?.name||"")}${w.medium?" · "+esc(w.medium):""}</p></div>
      <div class="right"><span class="status ${w.status}">${esc(w.status)}</span><button class="btn secondary small edit-artwork" data-id="${w.id}">Edit</button></div></article>`}).join("")||`<div class="empty">No matching artworks.</div>`}</div>
    ${paginationHtml(all.length,ui.artworkPage,PAGE_SIZE)}
  </section>`;
  $("#artworkSearch")?.addEventListener("input",e=>{ui.search=e.target.value;ui.artworkPage=1;renderArtworks()});
  $("#artistFilter")?.addEventListener("change",e=>{ui.artistFilter=e.target.value;ui.artworkPage=1;renderArtworks()});
  $(".prev-page",workspace)?.addEventListener("click",()=>{ui.artworkPage--;renderArtworks();scrollTo({top:0,behavior:"smooth"})});
  $(".next-page",workspace)?.addEventListener("click",()=>{ui.artworkPage++;renderArtworks();scrollTo({top:0,behavior:"smooth"})});
  $("#addArtwork")?.addEventListener("click",()=>{ui.editingArtworkId="new";ui.draft={entity:"artwork",id:`art-${Date.now()}`,artistId:state.artists[0]?.id||"",title:"",image:"assets/placeholder.svg",thumbnail:"assets/placeholder.svg",medium:"",edition:"",dimensions:"",description:"",status:"available",path:"",sourceUrl:"",sortOrder:state.artworks.length+1};render()});
  $$(".edit-artwork",workspace).forEach(b=>b.addEventListener("click",()=>{ui.editingArtworkId=b.dataset.id;ui.selectedArtworkId=b.dataset.id;ui.draft={entity:"artwork",...clone(artwork(b.dataset.id))};render()}));
}
function renderArtworkEditor(){
  const d=ui.draft;ui.previewKind="artwork-draft";
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>${ui.editingArtworkId==="new"?"Add Artwork":"Edit Artwork"}</h2><p>Save the record, then Publish Preview to update the full browser-local site.</p></div></div>
    <form id="artworkForm">
      <div class="image-upload"><img id="artworkImagePreview" src="${esc(d.image||"assets/placeholder.svg")}" alt=""><div class="field"><label>Artwork image</label><label class="file-button">Choose replacement image<input type="file" id="artworkImageFile" accept="image/*"></label><small>Prototype uploads are resized before being stored in local browser storage.</small></div></div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field"><label>Artist</label><select name="artistId">${state.artists.map(a=>`<option value="${a.id}" ${d.artistId===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Status</label><select name="status"><option value="available" ${d.status==="available"?"selected":""}>Available</option><option value="sold" ${d.status==="sold"?"selected":""}>Sold</option><option value="hidden" ${d.status==="hidden"?"selected":""}>Hidden</option></select></div>
        <div class="field wide"><label>Title</label><input name="title" value="${esc(d.title)}"></div>
        <div class="field"><label>Medium / type</label><input name="medium" value="${esc(d.medium||"")}"></div>
        <div class="field"><label>Edition</label><input name="edition" value="${esc(d.edition||"")}"></div>
        <div class="field wide"><label>Dimensions</label><input name="dimensions" value="${esc(d.dimensions||"")}"></div>
        <div class="field wide"><label>Description</label><textarea name="description">${esc(d.description||"")}</textarea></div>
        <div class="field wide"><label>Published preview address</label><input id="generatedUrl" value="${esc(publishedPath(d))}" disabled><small>Existing works retain their extracted URLs. Newly added works use a generic generated-detail route in this static prototype.</small></div>
      </div>
      <div class="form-actions"><button type="button" class="btn secondary" id="cancelArtwork">Cancel</button><button class="btn primary">Save Changes</button></div>
    </form></section>`;
  bindDraft($("#artworkForm"),["artistId","status","title","medium","edition","dimensions","description"]);
  $("#artworkForm")?.addEventListener("input",()=>{$("#generatedUrl").value=publishedPath(d)});
  $("#artworkImageFile")?.addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;d.image=await imageData(f);d.thumbnail=d.image;$("#artworkImagePreview").src=d.image;renderPreview()});
  $("#cancelArtwork")?.addEventListener("click",()=>{ui.draft=null;ui.editingArtworkId=null;render()});
  $("#artworkForm")?.addEventListener("submit",e=>{e.preventDefault();if(!d.title.trim()||!d.artistId){showToast("Artist and title are required.");return}
    const isNew=ui.editingArtworkId==="new";if(isNew){d.path=`artwork.html?id=${encodeURIComponent(d.id)}`;state.artworks.push(cleanEntity(d))}
    else state.artworks[state.artworks.findIndex(w=>w.id===d.id)]=cleanEntity(d);
    ui.selectedArtworkId=d.id;recordChange(`${isNew?"Added":"Updated"} artwork: ${d.title}`);showToast("Artwork saved.");ui.draft=null;ui.editingArtworkId=null;render();
  });
}
function renderSite(){
  ui.previewKind="site-draft";ui.draft={entity:"site",...clone(state.siteInfo)};const d=ui.draft;
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>Basic site information</h2><p>Update information that can be reused across every generated page.</p></div></div>
    <form id="siteForm"><div class="form-grid">
      <div class="field wide"><label>Gallery name</label><input name="galleryName" value="${esc(d.galleryName)}"></div>
      <div class="field wide"><label>Street address</label><input name="address" value="${esc(d.address)}"></div>
      <div class="field wide"><label>City, state & ZIP</label><input name="cityStateZip" value="${esc(d.cityStateZip)}"></div>
      <div class="field"><label>Phone</label><input name="phone" value="${esc(d.phone)}"></div>
      <div class="field"><label>Toll-free phone</label><input name="tollFree" value="${esc(d.tollFree)}"></div>
      <div class="field"><label>Email</label><input name="email" value="${esc(d.email)}"></div>
      <div class="field"><label>Hours</label><input name="hours" value="${esc(d.hours)}"></div>
    </div><div class="form-actions"><button class="btn primary">Save Site Information</button></div></form>
  </section>`;
  bindDraft($("#siteForm"),["galleryName","address","cityStateZip","phone","tollFree","email","hours"]);
  $("#siteForm")?.addEventListener("submit",e=>{e.preventDefault();state.siteInfo=cleanEntity(d);recordChange("Updated basic site information");showToast("Site information saved.");render()});
}
function renderPages(){
  if(ui.editingPageId!==null||ui.draft?.entity==="page"){renderPageEditor();return}
  ui.previewKind="page";
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>General pages</h2><p>${state.pages.length} extracted informational pages are available in this prototype.</p></div></div>
    <div class="artwork-list">${state.pages.map(p=>`<article class="artwork-row">
      <div style="width:54px;height:54px;border-radius:8px;background:#eee7e1;display:grid;place-items:center;font:500 20px Georgia,serif">Aa</div>
      <div><h3>${esc(p.title)}</h3><p>${esc((p.body||"").slice(0,110))}${(p.body||"").length>110?"…":""}</p></div>
      <div class="right"><button class="btn secondary small edit-page" data-id="${p.id}">Edit</button></div></article>`).join("")}</div>
  </section>`;
  $$(".edit-page",workspace).forEach(b=>b.addEventListener("click",()=>{ui.editingPageId=b.dataset.id;ui.selectedPageId=b.dataset.id;ui.draft={entity:"page",...clone(state.pages.find(p=>p.id===b.dataset.id))};render()}));
}
function renderPageEditor(){
  const d=ui.draft;ui.previewKind="page-draft";
  workspace.innerHTML=`<section class="panel"><div class="panel-header"><div><h2>Edit Page</h2><p>The template controls layout while gallery staff edit the content.</p></div></div>
    <form id="pageForm"><div class="form-grid"><div class="field wide"><label>Page title</label><input name="title" value="${esc(d.title)}"></div><div class="field wide"><label>Page content</label><textarea name="body" style="min-height:330px">${esc(d.body||"")}</textarea></div></div>
    <div class="form-actions"><button type="button" class="btn secondary" id="cancelPage">Cancel</button><button class="btn primary">Save Page</button></div></form></section>`;
  bindDraft($("#pageForm"),["title","body"]);
  $("#cancelPage")?.addEventListener("click",()=>{ui.draft=null;ui.editingPageId=null;render()});
  $("#pageForm")?.addEventListener("submit",e=>{e.preventDefault();state.pages[state.pages.findIndex(p=>p.id===d.id)]=cleanEntity(d);recordChange(`Updated page: ${d.title}`);showToast("Page saved.");ui.draft=null;ui.editingPageId=null;render()});
}
function imageFiltered(){
  const q=ui.search.trim().toLowerCase();
  return state.artworks.filter(w=>{const a=artist(w.artistId);return !q||w.title.toLowerCase().includes(q)||(a?.name||"").toLowerCase().includes(q)});
}
function renderImages(){
  ui.previewKind="home";
  const all=imageFiltered(),pages=Math.max(1,Math.ceil(all.length/IMAGE_PAGE_SIZE));ui.imagePage=Math.min(ui.imagePage,pages);
  const start=(ui.imagePage-1)*IMAGE_PAGE_SIZE,list=all.slice(start,start+IMAGE_PAGE_SIZE);
  workspace.innerHTML=`<section class="panel">
    <div class="panel-header"><div><h2>Image library</h2><p>Browse the artwork images referenced by the full catalog.</p></div></div>
    <div class="toolbar"><div class="search"><input id="imageSearch" placeholder="Search images by artwork or artist…" value="${esc(ui.search)}"></div><span class="image-result-count">${all.length} images</span></div>
    <div class="media-grid">${list.map(w=>{const a=artist(w.artistId);return `<article class="media-card"><img src="${esc(w.thumbnail||w.image||"assets/placeholder.svg")}" alt=""><div><strong>${esc(w.title)}</strong><span>${esc(a?.name||"")}</span><br><button class="btn secondary small media-edit" data-id="${w.id}" style="margin-top:7px">Edit artwork</button></div></article>`}).join("")}</div>
    ${paginationHtml(all.length,ui.imagePage,IMAGE_PAGE_SIZE)}
  </section>`;
  $("#imageSearch")?.addEventListener("input",e=>{ui.search=e.target.value;ui.imagePage=1;renderImages()});
  $(".prev-page",workspace)?.addEventListener("click",()=>{ui.imagePage--;renderImages();scrollTo({top:0,behavior:"smooth"})});
  $(".next-page",workspace)?.addEventListener("click",()=>{ui.imagePage++;renderImages();scrollTo({top:0,behavior:"smooth"})});
  $$(".media-edit",workspace).forEach(b=>b.addEventListener("click",()=>{ui.section="artworks";$$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.section==="artworks"));sectionTitle.textContent="Artworks";ui.editingArtworkId=b.dataset.id;ui.selectedArtworkId=b.dataset.id;ui.draft={entity:"artwork",...clone(artwork(b.dataset.id))};render()}));
}
function bindDraft(form,fields,checkbox=null){
  fields.forEach(name=>{const input=form.elements[name];if(!input)return;const h=()=>{ui.draft[name]=input.value;previewStatus.textContent="Unsaved preview";renderPreview()};input.addEventListener("input",h);input.addEventListener("change",h)});
  if(checkbox){const cb=form.elements[checkbox];cb?.addEventListener("change",()=>{ui.draft[checkbox]=cb.checked;previewStatus.textContent="Unsaved preview";renderPreview()})}
}
function cleanEntity(obj){const o=clone(obj);delete o.entity;return o}
function publishedPath(w){return w.path||`artwork.html?id=${encodeURIComponent(w.id)}`}
function imageData(file){
  return new Promise(resolve=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const max=850,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",.72))};img.src=r.result};r.readAsDataURL(file)})
}
function renderPreview(){
  const site=ui.draft?.entity==="site"?ui.draft:state.siteInfo;let body="";const unsaved=ui.draft?`<div class="unsaved-banner">Live preview of unsaved changes</div>`:"";
  if(ui.previewKind==="artwork"||ui.previewKind==="artwork-draft"){
    const w=ui.previewKind==="artwork-draft"?ui.draft:(artwork(ui.selectedArtworkId)||state.artworks[0]),a=artist(w.artistId);
    body=`${unsaved}<div class="site-head"><div class="site-brand">${esc(site.galleryName)}</div><div class="site-nav"><span>Artists</span><span>Our Guarantee</span><span>Contact</span></div></div>
    <div class="site-body"><div class="site-kicker">${esc(a?.name||"Artist")}</div><div class="site-artwork"><img src="${esc(w.image||"assets/placeholder.svg")}" alt=""><div><h2>${esc(w.title||"Untitled Artwork")}</h2><p>by ${esc(a?.name||"Artist")}</p><span class="site-status">${esc(w.status)}</span><div class="site-meta">${w.medium?`<div><strong>Medium</strong>${esc(w.medium)}</div>`:""}${w.edition?`<div><strong>Edition</strong>${esc(w.edition)}</div>`:""}${w.dimensions?`<div><strong>Dimensions</strong>${esc(w.dimensions)}</div>`:""}</div>${w.description?`<p>${esc(w.description)}</p>`:""}</div></div></div>`;
  }else if(ui.previewKind==="artist"||ui.previewKind==="artist-draft"){
    const a=ui.previewKind==="artist-draft"?ui.draft:(artist(ui.selectedArtistId)||state.artists[0]),works=worksFor(a.id).filter(w=>w.status!=="hidden").slice(0,3);
    body=`${unsaved}<div class="site-head"><div class="site-brand">${esc(site.galleryName)}</div><div class="site-nav"><span>Artists</span><span>Our Guarantee</span><span>Contact</span></div></div><div class="site-body"><div class="site-artist-hero"><img src="${esc(a.image||"assets/placeholder.svg")}" alt=""><div><div class="site-kicker">Featured artist</div><h2>${esc(a.name||"Artist Name")}</h2><p>${esc((a.bio||"").slice(0,520))}${(a.bio||"").length>520?"…":""}</p></div></div><div class="site-mini-grid">${works.map(w=>`<div class="site-mini-card"><img src="${esc(w.thumbnail||w.image)}" alt=""><span>${esc(w.title)}</span></div>`).join("")}</div></div>`;
  }else if(ui.previewKind==="homepage-draft"){
    const h=ui.draft||state.homepage||{},ids=h.featuredArtistIds||[],featured=ids.map(id=>artist(id)).filter(a=>a&&a.active).slice(0,12);
    body=`${unsaved}<div class="site-head"><div class="site-brand">${esc(site.galleryName)}</div><div class="site-nav"><span>Artists</span><span>Our Guarantee</span><span>Contact</span></div></div>
      <div class="site-home-hero"><div class="site-kicker">${esc(h.eyebrow||"")}</div><h2>${esc(h.headline||"")}</h2><p>${esc(h.intro||"")}</p></div>
      <div class="site-body"><div class="site-kicker">${esc(h.artistsEyebrow||"Artists")}</div><h3>${esc(h.artistsHeading||"Explore the collection")}</h3><p>${esc(h.artistsIntro||"")}</p>
      <div class="site-home-artists">${featured.slice(0,3).map(a=>`<div><img src="${esc(a.image)}" alt=""><h3>${esc(a.name)}</h3></div>`).join("")}</div></div>`;
}else if(ui.previewKind==="site-draft"){
    body=`${unsaved}<div class="site-head"><div class="site-brand">${esc(site.galleryName)}</div></div><div class="site-body"><div class="site-kicker">Visit the gallery</div><h2>Contact & Location</h2><div class="site-info-card"><h3>${esc(site.galleryName)}</h3><p>${esc(site.address)}<br>${esc(site.cityStateZip)}</p><p>${esc(site.phone)} · ${esc(site.tollFree)}<br>${esc(site.email)}</p><p><strong>Hours:</strong> ${esc(site.hours)}</p></div></div>`;
  }else if(ui.previewKind==="page"||ui.previewKind==="page-draft"){
    const p=ui.previewKind==="page-draft"?ui.draft:(state.pages.find(x=>x.id===ui.selectedPageId)||state.pages[0]);
    body=`${unsaved}<div class="site-head"><div class="site-brand">${esc(site.galleryName)}</div></div><div class="site-body"><div class="site-kicker">Gallery information</div><h2>${esc(p.title)}</h2><p>${esc((p.body||"").slice(0,1600)).replace(/\\n/g,"<br>")}</p></div>`;
  }else{
    const h=state.homepage||{},ids=h.featuredArtistIds||[],featured=(ids.length?ids.map(id=>artist(id)).filter(a=>a&&a.active):state.artists.filter(a=>a.active)).slice(0,3);
    body=`<div class="site-head"><div class="site-brand">${esc(site.galleryName)}</div><div class="site-nav"><span>Artists</span><span>Our Guarantee</span><span>Contact</span></div></div><div class="site-home-hero"><div class="site-kicker">${esc(h.eyebrow||"Sedona · Arizona · Fine Art Gallery")}</div><h2>${esc(h.headline||"Fine art in the heart of Sedona.")}</h2><p>${esc(h.intro||"")}</p></div><div class="site-body"><div class="site-kicker">${esc(h.artistsEyebrow||"Artists")}</div><h3>${esc(h.artistsHeading||"Explore the collection")}</h3><p>${esc(h.artistsIntro||"")}</p><div class="site-home-artists">${featured.map(a=>`<div><img src="${esc(a.image)}" alt=""><h3>${esc(a.name)}</h3></div>`).join("")}</div></div>`;
  }
  previewFrame.innerHTML=`<div class="site-preview">${body}</div>`;if(!ui.draft)previewStatus.textContent="Saved draft";
}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.section)));
$("#resetDemo").addEventListener("click",()=>{if(!confirm("Reset all draft and published-preview edits and restore the original full catalog?"))return;localStorage.removeItem(DRAFT_KEY);localStorage.removeItem(PUBLISHED_KEY);state=clone(baseline);ui.selectedArtistId=state.artists[0]?.id||null;ui.selectedArtworkId=state.artworks[0]?.id||null;ui.selectedPageId=state.pages[0]?.id||null;showToast("Full demo restored.");navigate("dashboard")});
$("#publishButton").addEventListener("click",()=>{
  if(!(state.meta.unpublishedChanges||0)) return;
  const published=clone(state);published.meta.publishedAt=new Date().toISOString();published.meta.unpublishedChanges=0;
  try{
    localStorage.setItem(PUBLISHED_KEY,JSON.stringify(published));
    state.meta.publishedAt=published.meta.publishedAt;state.meta.unpublishedChanges=0;
    state.meta.activity.unshift("Published browser-local website preview");persist();updatePending();$("#publishDialog").showModal();
  }catch{showToast("Browser storage is full. Reset the demo or remove uploaded images.")}
});
updatePending();render();
})();