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


window.onmessage = (ev) => {
  console.log("Got message now...");

  var type = ev.data.data.message.type;
  
  if (type  == "image") {
      var url = ev.data.data.message.url;
      console.log("Got a new image...")
      console.log(url);
      const image = document.createElement("img");
      image.src = url;
      zoomistImageContainer.appendChild(image);

      const zoomist = new Zoomist('.zoomist-container', {
        //maxScale: 1,
        bounds: false,
        /*initScale: 1,*/
        initScale: 0.5,
        slider: true, 
        zoomer: true,
        zoomRatio: 0.08
      });
  }

}
