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

document.addEventListener('pointerup', detectDoubleTap(280));// initialize the new event

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
var messageCount = 0;

function loadImage() {
  if ( zoomistImageContainer.childElementCount == 0 ){
      console.log('Webview: Sending ready message');
      window.parent.postMessage({
      type: 'ready'
      }, '*');
  }
}

loadImage();
var imageAdded = false;

// Add a fallback test after 5 seconds if no image is loaded
setTimeout(() => {
  if (!imageAdded) {
    console.log('Webview: No image loaded after 5 seconds, trying fallback test');
    // Try to load a test image to see if the basic functionality works
    const testImage = document.createElement("img");
    testImage.src = "https://via.placeholder.com/500x500/FF0000/FFFFFF?text=TEST";
    testImage.style.width = "100%";
    testImage.style.height = "100%";
    testImage.onload = () => {
      console.log('Webview: Test image loaded successfully');
      const lind = document.getElementById("loading-indicator");
      if (lind) lind.style.display = "none";
    };
    testImage.onerror = () => {
      console.error('Webview: Even test image failed to load');
    };
    zoomistImageContainer.appendChild(testImage);
    zoomistContainer.style.display = "block";
  }
}, 5000);
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
  messageCount++;
  console.log('Webview: Received message', event.data);
  console.log('Webview: Message structure:', JSON.stringify(event.data, null, 2));
  
  // Update debug info
  document.getElementById('message-count').textContent = `Messages received: ${messageCount}`;
  document.getElementById('last-message').textContent = `Last message: ${JSON.stringify(event.data).substring(0, 100)}...`;
  
  // Handle different possible message formats
  let dataObj = event.data;
  
  // Handle Devvit Web message format
  if (dataObj.type === 'devvit-message' && dataObj.data) {
    console.log('Webview: Found devvit-message wrapper, unwrapping');
    dataObj = dataObj.data;
    
    // Check if the actual message is nested inside a 'message' property
    if (dataObj.message && dataObj.message.type) {
      console.log('Webview: Found nested message property, extracting');
      dataObj = dataObj.message;
    }
  } else if (dataObj.data && dataObj.data.type) {
    console.log('Webview: Found nested data structure');
    dataObj = dataObj.data;
  }

  console.log('Webview: Final dataObj:', dataObj);
  console.log('Webview: Processing message type:', dataObj.type);
  var type = dataObj.type;
  
  if (type  == "image" && !imageAdded ) {
      console.log('Webview: Processing image message', dataObj);
      console.log('Webview: Image URL:', dataObj.url);
      console.log('Webview: Tiles data:', dataObj.tilesData);

      // Validate that we have the required data
      if (!dataObj.url) {
        console.error('Webview: No image URL provided!');
        return;
      }

      imageUrl = dataObj.url;
      tilesData =  dataObj.tilesData;
      ugs = dataObj.ugs;
      userIsAuthor = dataObj.userIsAuthor;
      validTileSpotsMarkingDone = dataObj.validTileSpotsMarkingDone;
      playersCount = dataObj.playersCount;
      spotsCount = dataObj.spotsCount;
      imageAdded = true;
      
      console.log('Webview: Making zoomist container visible');
      zoomistContainer.style.display = "block";
      
      console.log('Webview: Creating image element with URL:', imageUrl);
      const image = document.createElement("img");
      image.height = "100%";
      image.width = "100%";
      image.src = imageUrl;
      image.id = "spottitImage";
      
      // Add image to container first
      zoomistImageContainer.appendChild(image);
      console.log('Webview: Image element added to container');
      
      // Force a check to see if image loads
      setTimeout(() => {
        console.log('Webview: Checking image load status after 2 seconds');
        console.log('Webview: Image complete:', image.complete);
        console.log('Webview: Image naturalWidth:', image.naturalWidth);
        if (image.complete && image.naturalWidth > 0) {
          console.log('Webview: Image loaded successfully (delayed check)');
        } else {
          console.log('Webview: Image still loading or failed (delayed check)');
        }
      }, 2000);

      image.onload = () => {
        console.log('Webview: Image loaded successfully');
        document.getElementById('image-status').textContent = 'Image status: Loaded successfully';
        const lind = document.getElementById("loading-indicator");
        lind.style.display = "none";
        if( ugs.state != gameStates.Aborted && ugs.state != gameStates.Finished && !userIsAuthor ) {
          console.log('Webview: Adding tiles overlay and starting game');
          appendTilesOverlay(tilesData);
          window.parent.postMessage({
            type: 'startOrResumeGame'
          }, '*');
        }
      }
      
      image.onerror = () => {
        console.error('Webview: Failed to load image:', imageUrl);
        document.getElementById('image-status').textContent = `Image status: Failed to load ${imageUrl}`;
      }
    
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
        type: 'successfulSpotting',
        row: event.currentTarget.row,
        col: event.currentTarget.col,
        }, '*');

        ugs.foundSpots.push( event.currentTarget.spotNumber );
        if( ugs.foundSpots.length ==  spotsCount) {
          successfullySpottedAllSpots = true;
        }
        
    } else  {
      window.parent.postMessage({
        type: 'repeatSpotting',
        row: event.currentTarget.row,
        col: event.currentTarget.col,
        }, '*');
    }
  }
}

function sendFailedSpotting(event) {
  if( !zoomed && !successfullySpottedAllSpots ) {
    window.parent.postMessage({
      type: 'unsuccessfulSpotting',
      row: event.currentTarget.row,
      col: event.currentTarget.col,
      }, '*');
  }
}
