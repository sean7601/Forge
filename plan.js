When Forge is compiled with security Headers, it will let you create the blocked file types below. but when you go to write to that file, it deletes it
This does not happen before compiling with security headers and does not happen with the allowed file types (allowed and blocked file types were discovered through testing and are not exhaustive)

blocked write: .exe; .js, .hta
allowed write: .html, .css, .txt, .xml, .java, .ps1, .sh


$(".tab-close").click()

$(".forge-create-file-btn").click()

$("#create-file-name-input").val("devconsole.js")

setTimeout(function(){$("#create-file-confirm-btn").click()},2000)

setTimeout(function(){$($(".cm-content")[0]).html("devconsolecontent")},2000)


setTimeout(function(){$($("#saveButton")[0]).click()},5000)