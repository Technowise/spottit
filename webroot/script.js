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

document.addEventListener('pointerup', detectDoubleTap(500));// initialize the new event

const zoomistImageContainer = document.getElementById("zoomist-image");
const zoomistContainer = document.getElementById("zoomist-container");
var tilesData = null;//TODO: use class and avoid using global vars later.
var imageUrl = null;
var ugs = null;
var userIsAuthor = false;
var validTileSpotsMarkingDone = false;
var playersCount = 0;
var successfullySpottedAllSpots = false;
var spotsCount = 0;

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
var dragged = false;
var zoomTimeoutId = null;
var dragTimeoutId = null;
var dragStartX = 0;
var dragStartY = 0;

const gameStates = Object.freeze( {
  NotStarted: 0,
  Started: 1,
  Finished: 2,
  Aborted: 3, 
  Paused: 4
});

window.addEventListener('message', (event) => {
  dataObj = event.data.data.message.data;

  var type = dataObj.type;
  
  if (type  == "image" && !imageAdded ) {

      imageUrl = dataObj.url;
      tilesData =  dataObj.tilesData;
      ugs = dataObj.ugs;
      userIsAuthor = dataObj.userIsAuthor;
      validTileSpotsMarkingDone = dataObj.validTileSpotsMarkingDone;
      playersCount = dataObj.playersCount;
      spotsCount = dataObj.spotsCount;
      imageAdded = true;
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
        zoomRatio: 0.1
      });
  
      zoomist.on('zoom', (zoomist, scale) => {
        zoomed = true;
        if( zoomTimeoutId !== null ) {
          clearTimeout(zoomTimeoutId);
        }

        zoomTimeoutId = setTimeout(function() { zoomed = false;}, 1800);//set it to false after possible double-click time has passed.
      });

      zoomist.on('dragStart', (zoomist, transform, event) => {
        dragStartX = transform.x;
        dragStartY = transform.y;
      });

      zoomist.on('dragEnd', (zoomist, transform, event) => {
        if(transform.x != dragStartX || transform.y != dragStartY) {
          dragged = true;
          if( dragTimeoutId !== null ) {
            clearTimeout(dragTimeoutId);
          }
  
          dragTimeoutId = setTimeout(function() { 
            dragged = false;
            dragStartX = 0;
            dragStartY = 0;
          }, 1800);//set it to false after possible drag time has passed.

        }
        else {
          dragged = false;
          dragStartX = 0;
          dragStartY = 0;
        }

      });

      zoomist.on('ready', (zoomist) => {
        var bodyElement = document.getElementsByTagName("body")[0];
        bodyElement.style.backgroundImage = "";
      });
  
      if( ugs.state != gameStates.Aborted && ugs.state != gameStates.Finished ) {
        appendTilesOverlay(tilesData);
        window.parent.postMessage({
          type: 'startOrResumeGame'
        }, '*');
      }

  }
  else if( type == "messageOverlay" ) {
    const button = document.getElementById("startResumeButton");
    button.style.display = "none";
    appendMessageOverlay(divPictureOverlayContainer, "You have found the spot in "+ev.data.data.counter+" seconds! Click on Leaderboard button to see time of others.");
    zoomistContainer.style.display = "none";
    divPictureOverlayContainer.style.display = "block";
  }
  
});

function appendMessageOverlay(divPictureOverlayContainer, message) {
  const messageOverlayDiv = document.createElement("div");
  messageOverlayDiv.id = "messageOverlay";
  messageOverlayDiv.innerHTML = message;
  divPictureOverlayContainer.appendChild(messageOverlayDiv);
}

function appendTilesOverlay(tilesData) {

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
      t.style.top = y * tilesData.sizey + 'px';//hard-coded height in pixel temporarily. TODO: Use webview for spot selection, and use higher pixel density/resolution with whole numbers.
      t.style.left = x * tilesData.sizex + 'px';
      if ( tile != 0 ) {
        
        t.addEventListener("doubletap", sendSuccessfulSpotting);//TODO: Show indication of the spot selected in UI.
        t.row = y;
        t.col = x;
        t.spotNumber = tile;
      }
      else {
        t.addEventListener("doubletap", sendFailedSpotting);//TODO: Show indication of the spot selected in UI.
        t.row = y;
        t.col = x;
      }
      tc.appendChild(t);
    }
  }

  div.appendChild(tc);
  zoomistImageContainer.appendChild(div);
}

function sendSuccessfulSpotting(event) {
  if( !zoomed && !successfullySpottedAllSpots ) {
    
    if( !ugs.foundSpots.includes(event.currentTarget.spotNumber) ) {
      window.parent.postMessage({
        type: 'succcessfulSpotting',
        row: event.currentTarget.row,
        col: event.currentTarget.col,
        }, '*');

        ugs.foundSpots.push( event.currentTarget.spotNumber );
        if( ugs.foundSpots.length ==  spotsCount) {
          successfullySpottedAllSpots = true;
        }
        
    } else  {
      window.parent.postMessage({
        type: 'repeatSucccessfulSpotting',
        row: event.currentTarget.row,
        col: event.currentTarget.col,
        }, '*');
    }
  }
}

function sendFailedSpotting(event) {
  if( !zoomed && !successfullySpottedAllSpots ) {
    window.parent.postMessage({
      type: 'unsucccessfulSpotting',
      row: event.currentTarget.row,
      col: event.currentTarget.col,
      }, '*');
  }
}
