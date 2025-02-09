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
var userIsAuthor = false;
var validTileSpotsMarkingDone = false;
var playersCount = 0;

/*
const divPictureOverlayContainer = document.createElement("div");
divPictureOverlayContainer.className = "pictureOverlayContainer";
divPictureOverlayContainer.id = "pictureOverlayContainer";
*/

function loadImage() {
  console.log("Load image called!");
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

/*
window.onmessage = (ev) => {
  console.log("message received on webview:");
  console.log(ev.data.data.message);

  var type = ev.data.data.message.type;
  
  if (type  == "image" && !imageAdded ) {

      imageUrl = ev.data.data.message.url;
      tilesData =  ev.data.data.message.tilesData;
      ugs = ev.data.data.message.ugs;
      userIsAuthor = ev.data.data.message.userIsAuthor;
      validTileSpotsMarkingDone = ev.data.data.message.validTileSpotsMarkingDone;
      playersCount = ev.data.data.message.playersCount;
      imageAdded = true;
      appendBGOverlay();
  }
  else if( type == "messageOverlay" ) {
    const button = document.getElementById("startResumeButton");
    button.style.display = "none";
    appendMessageOverlay(divPictureOverlayContainer, "You have found the spot in "+ev.data.data.message.counter+" seconds! Click on Leaderboard button to see time of others.");
    zoomistContainer.style.display = "none";
    divPictureOverlayContainer.style.display = "block";
  }
}

*/

window.addEventListener('message', (event) => {
  dataObj = event.data.data.message.data;
  console.log("message received on webview:");
  console.log(dataObj);

  var type = dataObj.type;
  
  if (type  == "image" && !imageAdded ) {

      imageUrl = dataObj.url;
      tilesData =  dataObj.tilesData;
      ugs = dataObj.ugs;
      userIsAuthor = dataObj.userIsAuthor;
      validTileSpotsMarkingDone = dataObj.validTileSpotsMarkingDone;
      playersCount = dataObj.playersCount;
      imageAdded = true;
      //appendBGOverlay();


      //divPictureOverlayContainer.style.display = "none";
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
  
      appendTilesOverlay(tilesData);
  
      window.parent.postMessage({
        type: 'startOrResumeGame'
      }, '*');


  }
  else if( type == "messageOverlay" ) {
    const button = document.getElementById("startResumeButton");
    button.style.display = "none";
    appendMessageOverlay(divPictureOverlayContainer, "You have found the spot in "+ev.data.data.counter+" seconds! Click on Leaderboard button to see time of others.");
    zoomistContainer.style.display = "none";
    divPictureOverlayContainer.style.display = "block";
  }
  
});

function appendBGOverlay() {
  const button = document.createElement("button");
  button.id = "startResumeButton";
  const divPictureOverlay = document.createElement("div");
  divPictureOverlay.className = "pictureOverlay";
  divPictureOverlay.id = "pictureOverlay";

  divPictureOverlay.style.backgroundImage = "url('"+imageUrl+"')";
  divPictureOverlay.style.backgroundPosition = "center";
  divPictureOverlay.style.backgroundRepeat = "no-repeat";
  divPictureOverlay.style.backgroundSize =  "contain";

  if( (ugs.state == gameStates.Paused || ugs.state == gameStates.NotStarted) &&  !userIsAuthor ) {
    divPictureOverlay.style.filter = "blur(1px)";
  }

  if( userIsAuthor && validTileSpotsMarkingDone) {
    appendMessageOverlay(divPictureOverlayContainer, "Your Spottit post is ready for others to play. There have been "+playersCount+" players who have taken part so far.");
  }
  else if (ugs.state == gameStates.Finished) {
    appendMessageOverlay(divPictureOverlayContainer, "You have found the spot in "+ugs.counter+" seconds! Click on Leaderboard button to see time of others.");
  }
  else if( ugs.state == gameStates.Paused ) {
    button.innerHTML = "Resume!";
    divPictureOverlayContainer.appendChild(button);
  }
  else if(ugs.state == gameStates.NotStarted ) {
    button.innerHTML = "Start!";
    divPictureOverlayContainer.appendChild(button);
  }
  
  button.addEventListener("click", function() {
    divPictureOverlayContainer.style.display = "none";
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

    appendTilesOverlay(tilesData);

    window.parent.postMessage({
      type: 'startOrResumeGame'
    }, '*');

  }, false);

  divPictureOverlayContainer.appendChild(divPictureOverlay);

  document.body.appendChild(divPictureOverlayContainer);
}

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
      t.style.top = y * 27.11 + 'px';//hard-coded height in pixel temporarily. TODO: Use webview for spot selection, and use higher pixel density/resolution with whole numbers.
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
