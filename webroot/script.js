function detectDoubleTap(doubleTapMs) {
  let timeout, lastTap = 0
  return function detectDoubleTap(event) {
    const currentTime = new Date().getTime()
    const tapLength = currentTime - lastTap
    if (0 < tapLength && tapLength < doubleTapMs) {
      event.preventDefault()
      const doubleTap = new CustomEvent("doubletap", {
        bubbles: true,
        detail: event
      })
      event.target.dispatchEvent(doubleTap)
    } else {
      timeout = setTimeout(() => clearTimeout(timeout), doubleTapMs)
    }
    lastTap = currentTime
  }
}

// initialize the new event
document.addEventListener('pointerup', detectDoubleTap(500));

const zoomistImageContainer = document.getElementById("zoomist-image");
const zoomistContainer = document.getElementById("zoomist-container");
var tilesData = null;//TODO: use class and avoid using global vars later.
var imageUrl = null;

function loadImage() {
   if ( zoomistImageContainer.childElementCount == 0 ){
        window.parent.postMessage({
        type: 'requestImage'
        }, '*');
    }
}

loadImage();
var imageAdded = false;
var zoomed = false;

window.onmessage = (ev) => {

  var type = ev.data.data.message.type;
  
  if (type  == "image" && !imageAdded ) {
      imageUrl = ev.data.data.message.url;
      tilesData =  ev.data.data.message.tilesData;
/*
      console.log("Got a new image...");
      const image = document.createElement("img");
      image.src = url;
      image.id = "spottitImage";

      zoomistImageContainer.appendChild(image);

      const zoomist = new Zoomist('.zoomist-container', {
        bounds: false,
        initScale: 1,
        slider: true, 
        zoomer: true,
        zoomRatio: 0.08
      });

      zoomist.on('zoom', (zoomist, scale) => {
        zoomed = true;
        setTimeout(function() { zoomed = false;}, 1200);//set it to false after possible double-click time has passed.
      });
*/
      imageAdded = true;
      appendStartResumeOverlay();
      //TODO: add tilesData overlay only after clicking on start/resume button.
      //appendOverlay(tilesData);
  }
}

function appendStartResumeOverlay() {
  const div = document.createElement("div");
  div.className = "startOrResumeOverlay"
  div.id = "startOrResumeOverlay"
  const image = document.createElement("img");
  image.src = imageUrl;
  image.id = "spottitPreviewImage";

  const button = document.createElement("button");
  button.id = "startResumeButton";
  button.innerHTML = "Start";
  button.addEventListener("click", function() {
    console.log("You clicked on start!");
    var div = document.getElementById('startOrResumeOverlay');
    div.style.display = "none";
    zoomistContainer.style.display = "block";

    const image = document.createElement("img");
    image.height = "100%";
    image.width = "100%";
    image.src = imageUrl;
    image.id = "spottitImage";
    zoomistImageContainer.appendChild(image);

    const zoomist = new Zoomist('.zoomist-container', {
      bounds: false,
      initScale: 1,
      slider: true, 
      zoomer: true,
      zoomRatio: 0.08
    });
/*

    zoomist.on('zoom', (zoomist, scale) => {
      zoomed = true;
      setTimeout(function() { zoomed = false;}, 1200);//set it to false after possible double-click time has passed.
    });
    */

    appendOverlay(tilesData);

    window.parent.postMessage({
      type: 'startOrResumeGame'
    }, '*');

  }, false);

  div.appendChild(image);
  div.appendChild(button);

  //TODO: Add start/resume button inside the div.
  document.body.appendChild(div);
}

function appendOverlay(tilesData) {

  const div = document.createElement("div");
  div.className = "overlay"

  const tc = document.createElement("div");
  tc.className = "tiles-container";

  //Add tiles into tiles container:
  for(var y=0; y < tilesData.resolutiony; y ++ ) {
    
    for(var x=0; x < tilesData.resolutionx; x ++ ) {
      var elementIndex = y * tilesData.resolutionx + x;
      var tile = tilesData.data[ elementIndex ];
      const t = document.createElement("div");
      t.className = "tile";
      t.style.top = y * 13.555 + 'px';//hard-coded height in pixel temporarily. TODO: Use webview for spot selection, and use higher pixel density/resolution with whole numbers.
      t.style.left = x * tilesData.sizex + 'px';
      if ( tile == 1 ) {
        t.addEventListener("doubletap", sendSuccessfulSpotting);//TODO: Show indication of the spot selected in UI.
      } 
      else {
        t.addEventListener("doubletap", sendFailedSpotting);//TODO: Show indication of the spot selected in UI.
      }
      tc.appendChild(t);
    }
  }

  div.appendChild(tc);
  zoomistImageContainer.appendChild(div);
}

function sendSuccessfulSpotting() {

  if( !zoomed ) {
    window.parent.postMessage({
      type: 'succcessfulSpotting'
      }, '*');
  }
  zoomed = false;
}

function sendFailedSpotting() {
  if( !zoomed ) {
    window.parent.postMessage({
      type: 'unsucccessfulSpotting'
      }, '*');
  }
  zoomed = false;
}
