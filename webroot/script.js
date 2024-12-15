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
      console.log("Got a new image...")
      console.log(url);
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
  }


  if (true ) {

    const div = document.createElement("div");
    div.className = "overlay"

    div.addEventListener("click", myFunction);

    function myFunction() {
     // alert ("Hello World!");
      console.log("clicked on the red...")
    } 

    zoomistImageContainer.appendChild(div);
  }


}
