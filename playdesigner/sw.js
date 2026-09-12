/* Offline shell for the play designer. The app is one file, so precache it and
   serve it from the cache first — a coach in a field house has no signal. */
var CACHE='cpd-v4';
// everything the app is made of — there is nothing else to fetch
var ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){return k===CACHE?null:caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(
    caches.match(e.request,{ignoreSearch:true}).then(function(hit){
      if(hit){
        // refresh in the background so the next load is current
        fetch(e.request).then(function(r){
          if(r&&r.ok)caches.open(CACHE).then(function(c){c.put(e.request,r.clone());});
        }).catch(function(){});
        return hit;
      }
      return fetch(e.request).then(function(r){
        if(r&&r.ok&&e.request.url.indexOf('http')===0){
          var cl=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,cl);});
        }
        return r;
      }).catch(function(){return caches.match('./index.html');});
    })
  );
});
