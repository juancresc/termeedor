# Runs in the hidden completion shell, after the user's startup files. Requests arrive over a
# socket and set the line as a parameter. No key ever reaches this shell and nothing here accepts
# a line, so what is typed can't run as a command. Its terminal output is thrown away.

ZDOTDIR="$_tm_user_zdotdir"
typeset -g _tm_socket="$TERMEEDOR_COMPLETE_SOCKET" _tm_dump="$TERMEEDOR_ZDOTDIR/zcompdump"
unset TERMEEDOR_ZDOTDIR TERMEEDOR_USER_ZDOTDIR TERMEEDOR_COMPLETE_SOCKET _tm_user_zdotdir

# Nothing the user set up for a visible prompt may run here, and nothing may be left behind.
unset HISTFILE TMOUT PERIOD
typeset -g PROMPT='' RPROMPT='' PS2='' PS3='' PS4=''
precmd_functions=() preexec_functions=() chpwd_functions=() periodic_functions=() zshexit_functions=()
unfunction precmd preexec chpwd periodic zshexit TRAPALRM command_not_found_handler 2>/dev/null
zle -D zle-line-init zle-line-finish zle-line-pre-redraw zle-keymap-select 2>/dev/null
# MONITOR off keeps every child in this shell's process group, so killing the group gets them all.
# RCS off skips .zlogout. The menu options would answer a repeat request from the previous list.
unsetopt MONITOR NOTIFY RCS MENU_COMPLETE AUTO_MENU AUTO_LIST BASH_AUTO_LIST

zmodload zsh/net/socket || exit 1
zsocket "$_tm_socket" 2>/dev/null || exit 1
typeset -g _tm_fd=$REPLY

(( ${+_comps} )) || { autoload -Uz compinit && compinit -u -d "$_tm_dump"; } || exit 1
zstyle ':completion:*' insert-tab false

typeset -g _tm_line
typeset -ga _tm_out
typeset -gi _tm_group

_tm_quote() {
  case $compstate[quote] in
    (\') REPLY=${1//\'/\'\\\'\'} ;;
    (\") REPLY=${1//(#m)[\\\"\$\`]/\\$MATCH} ;;
    (*) REPLY=${(q)1} ;;
  esac
}

# Records what each call would add, with what zsh would put around it, then adds it for real so
# that compsys goes on exactly as it does for the user. Calls that only filter a list pass through.
compadd() {
  setopt localoptions extendedglob no_ksh_arrays no_rc_expand_param no_sh_word_split
  local _tm_P= _tm_p= _tm_S= _tm_s= _tm_W= _tm_d= _tm_arg= _tm_value= _tm_c=
  integer _tm_i=1 _tm_j=0 _tm_f=0 _tm_Q=0 _tm_hasS=0 _tm_nosort=0 _tm_filter=0 _tm_ret=0
  while (( _tm_i <= $# )); do
    _tm_arg=${@[_tm_i]}
    [[ $_tm_arg == (-|--) || $_tm_arg != -* ]] && break
    for (( _tm_j = 2; _tm_j <= $#_tm_arg; _tm_j++ )); do
      _tm_c=$_tm_arg[_tm_j]
      case $_tm_c in
        (f) _tm_f=1 ;;
        (Q) _tm_Q=1 ;;
        (o|[PSpsiIWdJVXxrRMFEODA])
          _tm_value=$_tm_arg[_tm_j+1,-1]
          if [[ -z $_tm_value ]] && { [[ $_tm_c != o ]] || [[ ${@[_tm_i+1]} == (match|nosort|numeric|reverse)(|,*) ]]; }; then
            (( _tm_i++ ))
            _tm_value=${@[_tm_i]}
          fi
          case $_tm_c in
            (P) _tm_P=$_tm_value ;;
            (p) _tm_p=$_tm_value ;;
            (S) _tm_S=$_tm_value _tm_hasS=1 ;;
            (s) _tm_s=$_tm_value ;;
            (W) _tm_W=$_tm_value ;;
            (d) _tm_d=$_tm_value ;;
            (V) _tm_nosort=1 ;;
            (o) [[ $_tm_value == *nosort* ]] && _tm_nosort=1 ;;
            ([ODA]) _tm_filter=1 ;;
          esac
          break ;;
      esac
    done
    (( _tm_i++ ))
  done

  if (( _tm_filter )); then
    builtin compadd "$@"
    return
  fi

  local -a _tm_hits _tm_dscr
  [[ -n $_tm_d && $_tm_d != \(* ]] && _tm_dscr=("${(@P)_tm_d}")
  if (( $#_tm_dscr )); then
    builtin compadd -A _tm_hits -D _tm_dscr "$@"
  else
    builtin compadd -A _tm_hits "$@"
  fi
  builtin compadd "$@"
  _tm_ret=$?
  _tm_record
  return _tm_ret
}

_tm_record() {
  local raw=$IPREFIX$PREFIX
  integer stop=$(( $#LBUFFER - $#raw ))
  [[ $LBUFFER[stop+1,-1] == "$raw" ]] || return # the line doesn't end with the word, so there is nowhere to put these

  # Here LBUFFER has the word's quotes taken out, so the line as typed says where the word starts.
  integer at=$#_tm_line from=$#LBUFFER
  while (( from > stop && at > 0 )); do
    [[ $_tm_line[at] == "$LBUFFER[from]" ]] && (( from-- ))
    (( at-- ))
  done
  local base=$_tm_line[1,at] closer= word text plain dir suffix kind note REPLY
  [[ $compstate[quote] == [\'\"] ]] && closer=$compstate[quote]
  dir=${(Q)_tm_p}
  [[ $dir == \~/* ]] && dir=$HOME/${dir#\~/}
  (( _tm_group++ ))
  integer i folder
  for (( i = 1; i <= $#_tm_hits && $#_tm_out < 12000; i++ )); do
    word=$_tm_hits[i]
    [[ -n $word ]] || continue
    if (( _tm_Q )); then text=$word plain=${(Q)word}; else _tm_quote "$word"; text=$REPLY plain=$word; fi

    folder=0
    (( _tm_f )) && [[ -d $dir$plain || ( -n $_tm_W && -d $_tm_W/$plain ) ]] && folder=1
    if (( folder )); then
      # A quote stays open, so that the next Tab goes on inside the folder.
      suffix=/
      [[ $_tm_s == */* ]] && suffix=
      text=$base$IPREFIX$_tm_P$_tm_p$text$_tm_s$suffix
      kind=folder
    else
      if (( _tm_hasS )); then suffix=$_tm_S
      elif [[ $word == */ ]]; then suffix=
      elif [[ $IPREFIX == *[\'\"]* ]]; then suffix= # inside a quote that zsh isn't handling
      else suffix=' '
      fi
      text=$base$IPREFIX$_tm_P$_tm_p$text$_tm_s$closer$suffix
      if (( _tm_f )); then kind=file
      elif [[ $_tm_S$_tm_s == */* ]]; then kind=folder
      elif [[ $curtag == (*commands*|builtins|*aliases*|functions|reserved-words) ]]; then kind=command
      elif [[ $_tm_P$word == -* ]]; then kind=option
      else kind=value
      fi
    fi

    plain=$_tm_P$plain
    [[ $kind == folder && $plain != */ ]] && plain+=/
    note=${_tm_dscr[i]}
    [[ $note == *' -- '* ]] && note=${${note#* -- }## #} || note=
    _tm_out+=("$text" "$plain" "$kind" "$note" "$_tm_group" "$_tm_nosort")
  done
}

_tm_quiet() {
  compstate[insert]=''
  compstate[list]=''
}

# Only the completers that read the line: _expand would evaluate it, and others rewrite it.
_tm_collect() {
  comppostfuncs=(_tm_quiet)
  _main_complete _complete _ignored
  compstate[insert]=''
  compstate[list]=''
}
zle -C _tm_capture .complete-word _tm_collect

_tm_on_request() {
  [[ -z $2 ]] || exit 0
  local id dir newpath line
  IFS= read -r -d '' -u $_tm_fd id &&
    IFS= read -r -d '' -u $_tm_fd dir &&
    IFS= read -r -d '' -u $_tm_fd newpath &&
    IFS= read -r -d '' -u $_tm_fd line || exit 0 # the app is gone

  _tm_out=()
  _tm_group=0
  if builtin cd -q -- "$dir" 2>/dev/null; then
    [[ -n $newpath ]] && PATH=$newpath
    builtin rehash
    _tm_line=$line
    BUFFER=$line
    CURSOR=$#BUFFER
    zle _tm_capture
    BUFFER=''
    CURSOR=0
  fi
  print -rN -u $_tm_fd -- "$id" "$(( $#_tm_out / 6 ))" "$_tm_out[@]"
}
zle -N _tm_on_request
zle -F -w $_tm_fd _tm_on_request
