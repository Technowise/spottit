
const zoomistImageContainer = document.getElementById("zoomist-image");

function loadImage() {
   if ( zoomistImageContainer.childElementCount == 0 ){
        window.parent.postMessage({
        type: 'requestImage'
        }, '*');
    }
}

loadImage();
var imageAdded = false;

window.onmessage = (ev) => {

  var type = ev.data.data.message.type;
  
  if (type  == "image" && !imageAdded ) {
      var url = ev.data.data.message.url;
      var tilesData =  ev.data.data.message.tilesData;
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
      imageAdded = true;
      appendOverlay(tilesData);
  }
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
        t.addEventListener("click", sendSuccessfulSpotting);
      } 
      else {
        t.addEventListener("click", sendFailedSpotting);
      }
      tc.appendChild(t);
    }
  }

  div.appendChild(tc);
  zoomistImageContainer.appendChild(div);
}

function sendSuccessfulSpotting() {
  console.log("You successfully spotted it!");
  window.parent.postMessage({
    type: 'succcessfulSpotting'
    }, '*');
}

function sendFailedSpotting() {
  console.log("that's not the right spot :(");
  window.parent.postMessage({
    type: 'unsucccessfulSpotting'
    }, '*');
}
