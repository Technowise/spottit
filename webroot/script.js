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
var ugs = null;

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

const gameStates = Object.freeze( {
  NotStarted: 0,
  Started: 1,
  Finished: 2,
  Aborted: 3, 
  Paused: 4
});

window.onmessage = (ev) => {

  var type = ev.data.data.message.type;
  
  if (type  == "image" && !imageAdded ) {
      console.log("yeh lo, got this message:");
      console.log(ev.data.data.message);
      imageUrl = ev.data.data.message.url;
      tilesData =  ev.data.data.message.tilesData;
      ugs = ev.data.data.message.ugs;
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
  div.className = "startOrResumeOverlayBG";
  div.id = "startOrResumeOverlayBG";
  /*
  div.style.backgroundImage = "url('"+imageUrl+"')";
  div.style.backgroundPosition = "center";
  div.style.backgroundRepeat = "no-repeat";
  div.style.backgroundSize =  "contain";
  div.style.filter = "blur(1px)";
  */

  const button = document.createElement("button");
  button.id = "startResumeButton";


  const divStartResume = document.createElement("div");
  divStartResume.className = "startOrResumeOverlay";
  divStartResume.id = "startOrResumeOverlay";


  divStartResume.style.backgroundImage = "url('"+imageUrl+"')";
  divStartResume.style.backgroundPosition = "center";
  divStartResume.style.backgroundRepeat = "no-repeat";
  divStartResume.style.backgroundSize =  "contain";
  divStartResume.style.filter = "blur(1px)";


  if( ugs.state == gameStates.Paused ) {
    button.innerHTML = "Resume";
  }
  else if(ugs.state == gameStates.NotStarted ) {
    button.innerHTML = "Start";
  }
  else if (ugs.state == gameStates.Finished) {
    button.innerHTML = "You have finished this game.";
  }
  //TODO: handle other states.
  
  button.addEventListener("click", function() {
    console.log("You clicked on start!");
    var div = document.getElementById('startOrResumeOverlayBG');
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


    zoomist.on('zoom', (zoomist, scale) => {
      zoomed = true;
      setTimeout(function() { zoomed = false;}, 1200);//set it to false after possible double-click time has passed.
    });
    

    appendOverlay(tilesData);

    window.parent.postMessage({
      type: 'startOrResumeGame'
    }, '*');

  }, false);

  //divStartResume.appendChild(button);
  div.appendChild(divStartResume);
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
