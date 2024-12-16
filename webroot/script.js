/*
  const zoomist = new Zoomist('.zoomist-container', {
    maxScale: 4
  });
*/
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
  console.log("Got message now...");

  var type = ev.data.data.message.type;
  
  if (type  == "image" && !imageAdded ) {
      var url = ev.data.data.message.url;
      var tilesData =  ev.data.data.message.tilesData;
      console.log("Got a new image...")
      console.log(url);
      console.log( tilesData );
      const image = document.createElement("img");
      image.src = url;
      image.id = "spottitImage"
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

  /*
  div.addEventListener("click", myFunction);

  function myFunction() {
    //console.log("clicked on the red...")
  } 
  */

  const tc = document.createElement("div");
  tc.className = "tiles-container";

  //Add tiles into tiles container:
  var tileCount = 0;

  for(var y=0; y < tilesData.resolutiony; y ++ ) {
    
    for(var x=0; x < tilesData.resolutionx; x ++ ) {
      console.log("Column: "+x);
      var elementIndex = y * tilesData.resolutionx + x;
      var tile = tilesData.data[ elementIndex ];

      const t = document.createElement("div");
      t.className = "tile row"+y+" col"+x+" "+elementIndex;
      
      //t.style.top = y * tilesData.sizey + 'px';
      t.style.top = y * 13.55 + 'px';
      
      t.style.left = x * tilesData.sizex + 'px';
      
      if ( tile == 1 ) {
        t.style.backgroundColor = "red";
        tileCount++;
      }
      else {
        t.style.backgroundColor = "blue";
      }
      tc.appendChild(t);
    }
    console.log("row break "+ y);

  }

  console.log("Total on tiles: "+ tileCount);

  div.appendChild(tc);
  zoomistImageContainer.appendChild(div);

}
