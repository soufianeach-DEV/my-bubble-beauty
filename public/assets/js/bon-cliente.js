/* Bon cadeau : choisir une cliente dans la liste remplit « Pour » et l'e-mail s'ils sont vides.
   Sans ce fichier, le serveur fait le même remplissage à l'enregistrement. */
(()=>{
const pick=document.getElementById('client'),who=document.getElementById('recipient'),mail=document.getElementById('recipient_email');
if(!pick||!who||!mail)return;
pick.addEventListener('change',()=>{
  const m=/^(.*?)\s*<([^<>]+)>\s*$/.exec(pick.value.trim());
  const name=m?m[1]:'',email=(m?m[2]:pick.value).trim();
  if(!email.includes('@'))return;
  if(!who.value.trim()&&name)who.value=name;
  if(!mail.value.trim())mail.value=email;
});
})();
