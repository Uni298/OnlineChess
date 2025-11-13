class ChessGame {
    constructor() {
        this.socket = io();
        this.board = [];
        this.selectedPiece = null;
        this.validMoves = [];
        this.playerColor = null;
        this.currentTurn = null;
        this.gameId = null;
        
        this.init();
    }

    init() {
        this.setupSocketListeners();
        this.createBoard();
    }

    setupSocketListeners() {
        this.socket.on('waiting', (data) => {
            this.updateStatus('対戦相手を待っています...');
        });

        this.socket.on('gameStart', (data) => {
            this.gameId = data.gameId;
            this.playerColor = data.color;
            this.board = data.board;
            this.currentTurn = 'white';
            this.updateStatus('ゲーム開始！');
            this.updatePlayerInfo();
            this.renderBoard();
        });

        this.socket.on('boardUpdate', (data) => {
            this.board = data.board;
            this.currentTurn = data.currentPlayer;
            this.renderBoard();
            this.updatePlayerInfo();
            
            if (data.lastMove) {
                this.highlightLastMove(data.lastMove);
                this.addMoveToHistory(data.lastMove, data.currentPlayer === 'white' ? 'black' : 'white');
            }
            
            if (data.gameOver) {
                this.showGameOver(data.winner);
            }
        });

        this.socket.on('opponentDisconnected', () => {
            this.updateStatus('相手が切断しました。新しい対戦を探しています...');
            setTimeout(() => {
                location.reload();
            }, 3000);
        });
    }

    createBoard() {
        const chessboard = document.getElementById('chessboard');
        chessboard.innerHTML = '';
        
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'white' : 'black'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                
                // 座標表示
                if (row === 7) {
                    const fileCoord = document.createElement('div');
                    fileCoord.className = 'coordinates file';
                    fileCoord.textContent = files[col];
                    square.appendChild(fileCoord);
                }
                
                if (col === 0) {
                    const rankCoord = document.createElement('div');
                    rankCoord.className = 'coordinates rank';
                    rankCoord.textContent = ranks[row];
                    square.appendChild(rankCoord);
                }
                
                square.addEventListener('click', () => this.handleSquareClick(row, col));
                chessboard.appendChild(square);
            }
        }
    }

    renderBoard() {
        const pieces = {
            'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
            'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
        };
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
                const piece = this.board[row][col];
                
                // 既存の駒をクリア
                const existingPiece = square.querySelector('.piece');
                if (existingPiece) {
                    existingPiece.remove();
                }
                
                // 新しい駒を追加
                if (piece) {
                    const pieceElement = document.createElement('div');
                    pieceElement.className = 'piece';
                    pieceElement.textContent = pieces[piece];
                    pieceElement.style.color = piece === piece.toLowerCase() ? 'black' : 'white';
                    square.appendChild(pieceElement);
                }
                
                // 選択状態と有効な移動のハイライトをクリア
                square.classList.remove('selected', 'valid-move', 'valid-capture');
            }
        }
        
        // 選択された駒と有効な移動をハイライト
        if (this.selectedPiece) {
            const { row, col } = this.selectedPiece;
            const selectedSquare = document.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
            selectedSquare.classList.add('selected');
            
            this.validMoves.forEach(move => {
                const targetSquare = document.querySelector(`.square[data-row="${move.row}"][data-col="${move.col}"]`);
                if (this.board[move.row][move.col]) {
                    targetSquare.classList.add('valid-capture');
                } else {
                    targetSquare.classList.add('valid-move');
                }
            });
        }
    }

    handleSquareClick(row, col) {
        // ゲームが開始していない場合は無視
        if (!this.gameId) return;
        
        // 相手のターンの場合は無視
        if (this.currentTurn !== this.playerColor) return;
        
        const piece = this.board[row][col];
        
        // 駒が選択されている場合
        if (this.selectedPiece) {
            const move = this.validMoves.find(m => m.row === row && m.col === col);
            
            if (move) {
                // 有効な移動先がクリックされた
                this.makeMove(this.selectedPiece.row, this.selectedPiece.col, row, col);
                this.selectedPiece = null;
                this.validMoves = [];
                return;
            }
            
            // 同じ色の別の駒がクリックされた
            if (piece && this.isOwnPiece(piece)) {
                this.selectedPiece = { row, col };
                this.calculateValidMoves(row, col, piece);
                this.renderBoard();
                return;
            }
            
            // 無効な移動先がクリックされた
            this.selectedPiece = null;
            this.validMoves = [];
            this.renderBoard();
            return;
        }
        
        // 駒が選択されていない場合
        if (piece && this.isOwnPiece(piece)) {
            this.selectedPiece = { row, col };
            this.calculateValidMoves(row, col, piece);
            this.renderBoard();
        }
    }

    isOwnPiece(piece) {
        if (this.playerColor === 'white') {
            return piece === piece.toUpperCase();
        } else {
            return piece === piece.toLowerCase();
        }
    }

    calculateValidMoves(row, col, piece) {
        this.validMoves = [];
        const pieceType = piece.toLowerCase();
        
        // 簡易的な移動ルール（実際のチェスルールとは異なります）
        switch (pieceType) {
            case 'p': // ポーン
                const direction = this.playerColor === 'white' ? -1 : 1;
                // 前方1マス
                if (this.isValidPosition(row + direction, col) && !this.board[row + direction][col]) {
                    this.validMoves.push({ row: row + direction, col });
                }
                // 斜めの取り
                [-1, 1].forEach(offset => {
                    if (this.isValidPosition(row + direction, col + offset) && 
                        this.board[row + direction][col + offset] && 
                        !this.isOwnPiece(this.board[row + direction][col + offset])) {
                        this.validMoves.push({ row: row + direction, col: col + offset });
                    }
                });
                break;
                
            case 'r': // ルーク
                this.addLinearMoves(row, col, [[-1,0],[1,0],[0,-1],[0,1]]);
                break;
                
            case 'n': // ナイト
                const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
                knightMoves.forEach(([dr, dc]) => {
                    const newRow = row + dr;
                    const newCol = col + dc;
                    if (this.isValidPosition(newRow, newCol) && 
                        (!this.board[newRow][newCol] || !this.isOwnPiece(this.board[newRow][newCol]))) {
                        this.validMoves.push({ row: newRow, col: newCol });
                    }
                });
                break;
                
            case 'b': // ビショップ
                this.addLinearMoves(row, col, [[-1,-1],[-1,1],[1,-1],[1,1]]);
                break;
                
            case 'q': // クイーン
                this.addLinearMoves(row, col, [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]);
                break;
                
            case 'k': // キング
                const kingMoves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
                kingMoves.forEach(([dr, dc]) => {
                    const newRow = row + dr;
                    const newCol = col + dc;
                    if (this.isValidPosition(newRow, newCol) && 
                        (!this.board[newRow][newCol] || !this.isOwnPiece(this.board[newRow][newCol]))) {
                        this.validMoves.push({ row: newRow, col: newCol });
                    }
                });
                break;
        }
    }

    addLinearMoves(startRow, startCol, directions) {
        directions.forEach(([dr, dc]) => {
            let row = startRow + dr;
            let col = startCol + dc;
            
            while (this.isValidPosition(row, col)) {
                if (!this.board[row][col]) {
                    this.validMoves.push({ row, col });
                } else {
                    if (!this.isOwnPiece(this.board[row][col])) {
                        this.validMoves.push({ row, col });
                    }
                    break;
                }
                row += dr;
                col += dc;
            }
        });
    }

    isValidPosition(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        this.socket.emit('move', {
            gameId: this.gameId,
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol }
        });
    }

    updateStatus(message) {
        document.getElementById('status').textContent = message;
    }

    updatePlayerInfo() {
        const playerColorElement = document.getElementById('playerColor');
        const currentTurnElement = document.getElementById('currentTurn');
        
        playerColorElement.textContent = this.playerColor === 'white' ? '白' : '黒';
        playerColorElement.className = `color ${this.playerColor}`;
        
        currentTurnElement.textContent = this.currentTurn === 'white' ? '白' : '黒';
        currentTurnElement.className = `turn ${this.currentTurn}`;
    }

    highlightLastMove(move) {
        const { from, to } = move;
        
        // 前回のハイライトをクリア
        document.querySelectorAll('.square').forEach(square => {
            square.classList.remove('last-move');
        });
        
        // 新しい移動をハイライト
        const fromSquare = document.querySelector(`.square[data-row="${from.row}"][data-col="${from.col}"]`);
        const toSquare = document.querySelector(`.square[data-row="${to.row}"][data-col="${to.col}"]`);
        
        if (fromSquare) fromSquare.classList.add('last-move');
        if (toSquare) toSquare.classList.add('last-move');
    }

    addMoveToHistory(move, player) {
        const movesList = document.getElementById('movesList');
        const moveItem = document.createElement('div');
        moveItem.className = `move-item ${player}`;
        
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        
        const fromNotation = `${files[move.from.col]}${ranks[move.from.row]}`;
        const toNotation = `${files[move.to.col]}${ranks[move.to.row]}`;
        
        moveItem.textContent = `${player === 'white' ? '白' : '黒'}: ${fromNotation} → ${toNotation}`;
        movesList.appendChild(moveItem);
        movesList.scrollTop = movesList.scrollHeight;
    }

    showGameOver(winner) {
        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over';
        gameOverDiv.innerHTML = `
            <div class="game-over-content">
                <h2>ゲーム終了！</h2>
                <p>${winner === this.playerColor ? 'あなたの勝利！' : '相手の勝利！'}</p>
                <button class="restart-btn" onclick="location.reload()">新しいゲームを始める</button>
            </div>
        `;
        document.body.appendChild(gameOverDiv);
    }
}

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    new ChessGame();
});
